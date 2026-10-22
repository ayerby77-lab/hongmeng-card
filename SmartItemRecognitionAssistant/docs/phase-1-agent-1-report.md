# 第一阶段 Agent 1 交接报告：图像采集

日期：2026-10-22。范围：相册选图、Camera Kit 预览拍照、前后摄像头切换、权限、生命周期、EXIF 方向归一化。
依据 [`docs/phase-1-contract.md`](phase-1-contract.md) 第 2、4.1、5.3 节实现；共享类型未做任何修改。

## 1. 修改文件

| 文件 | 变更 |
| --- | --- |
| `app/entry/src/main/ets/services/camera/ImageDecoder.ets` | 新增。共享解码管线：尺寸防护、EXIF 读取与归一化、RGBA_8888 解码、紧凑像素导出、原生对象释放 |
| `app/entry/src/main/ets/services/camera/GalleryImageService.ets` | 新增。契约 4.1 相册服务单例，实现 `ImageCaptureApi` |
| `app/entry/src/main/ets/services/camera/CameraPermission.ets` | 新增。相机权限查询/请求/系统设置跳转 |
| `app/entry/src/main/ets/services/camera/CameraCaptureService.ets` | 新增。Camera Kit 封装：枚举、会话、预览、拍照、切换、释放 |
| `app/entry/src/main/ets/components/camera/CameraPreview.ets` | 新增。XComponent 预览组件，内嵌快门/切换按钮与权限错误面板 |
| `app/entry/src/main/module.json5` | 新增 `ohos.permission.CAMERA` 声明（reason + usedScene=inuse/EntryAbility） |
| `app/entry/src/main/resources/base/element/string.json` | 新增 `camera_permission_reason` 文案 |
| `AGENTS.md` | 代码地图状态更新（camera 服务、camera 组件、权限状态） |

未触碰：`models/**`、`pages/Index.ets`、`services/inference/**`、`tasks/**`、`EntryAbility.ets`。

## 2. 对外接口

### 2.1 相册（契约 4.1，Agent 3 已按契约引用）

```ts
class GalleryImageService implements ImageCaptureApi {
  static getInstance(): GalleryImageService;
  pickFromGallery(): Promise<ImageSource>;  // 取消 -> RecognitionFailure(CANCELLED, '已取消选图', true)
  capturePhoto(): Promise<ImageSource>;     // 固定以普通 Error 拒绝：相机拍照走 CameraPreview
}
```

- 取消：resolve 空 `photoUris` → `CANCELLED`，页面已有图片/结果不受影响（契约 4.1）。
- 打开相册失败、读取失败、解码失败、超大图（宽×高 > 40,000,000 像素）、损坏图：`IMAGE_INVALID`，`recoverable=true`。
- URI 有效期：`PhotoViewPicker.select()` 返回 URI 带读授权，服务在 select 返回的同一调用栈内立即 `fs.openSync` 打开并解码，不持久化 URI；后续阶段如需长期保存，应复制像素而非保留 URI。
- 返回前已释放 `PixelMap`、解码用 `image.ImageSource`、文件 fd（契约 5.3）。

### 2.2 相机预览组件（`components/camera/CameraPreview.ets`）

```ts
interface CameraCaptureResult { image: ImageSource }
interface CameraErrorEvent { kind: string; message: string; recoverable: boolean }
interface CameraReadyEvent { cameras: CameraDeviceInfo[]; activeCameraId: string }

CameraPreview({
  onPhotoCaptured?: (result: CameraCaptureResult) => void,
  onCameraError?: (error: CameraErrorEvent) => void,
  onCameraReady?: (event: CameraReadyEvent) => void
})
```

Agent 3 对接方式：放置组件并处理三个回调。`onCameraError.kind` 取值：`permission`（权限拒绝/禁用，页面应保留相册入口）、`no-camera`（无摄像头）、`open-failed`、`capture-failed`、`decode-failed`。后两者为拍照级错误，组件内提示且预览不中断；前几种组件显示可操作面板（重新授权 / 前往系统设置 / 重试），页面需保证相册入口仍可用。

组件自带：快门按钮（READY 才可点）、“切换镜头”按钮（摄像头数 > 1 才显示）、启动/拍照遮罩、错误提示条。

### 2.3 相机服务（`CameraCaptureService`，单例）

- `enumerateCameras(context)`：过滤支持 `NORMAL_PHOTO` 的设备，输出 `{cameraId, position: back/front/other, displayName}`；只暴露一个摄像头时切换按钮自动隐藏。
- `start(context, cameraId, surfaceId)` / `switchCamera(...)` / `stop()`：内部串行队列执行，重复进入退出与快速切换不会产生并发会话。
- `capture()`：非 READY 以普通 Error 拒绝；`PhotoCaptureSetting` 显式 `mirror:false`、`QUALITY_LEVEL_HIGH`，`rotation` 由 `PhotoSession.getPhotoRotation()`（API 23+ 无参，系统取设备方向）计算，失败回退 `ROTATION_0`。
- 拍照经 `photoAvailable` 回调取 `photo.main`（`image.Image`）→ JPEG 字节 → `ImageDecoder` 管线 → 契约 `ImageSource`，随后释放 `image.Image` 与 `photo`。
- profile 选择：预览就近 1280×720、拍照就近 1920×1080（按面积，JPEG 格式优先），兼顾解码内存与 640 letterbox 输入。

## 3. 契约关键语义落实

- **像素格式**：全部输出 `RGBA_8888`，`rowStride = width*4`，`data` 紧凑长度 `rowStride*height`（契约允许 RGB/RGBA，统一 RGBA 简化实现）。
- **方向归一化层级**：由采集层（本模块 `ImageDecoder`）完成，Agent 2/3 不得再旋转。EXIF 映射：1 不变 / 2 水平翻转 / 3 转180 / 4 垂直翻转 / 5 水平翻转+顺时针270 / 6 顺时针90 / 7 垂直翻转+顺时针90 / 8 顺时针270，依据 image 模块 ORIENTATION 属性文档的变换描述。
- **镜像**：静态拍照 `isMirrored=false`（capture 显式 `mirror:false`）；前置镜像仅存在于系统预览层，不进像素。
- **不静默缩放**：解码不设 `desiredSize`；超大图以 `IMAGE_INVALID` 拒绝并提示换图（阈值 40M 像素，常规 12MP 照片可过）。
- **错误一致性**：取消 `CANCELLED`、图像类 `IMAGE_INVALID` 均为 `recoverable=true`；权限拒绝不经 `ImageSource` 表达，由组件/页面处理。

## 4. 验证结果

| 项目 | 结果 |
| --- | --- |
| `./scripts/build-app.sh` 全量构建（2026-10-22，本机） | 通过，`entry-default-unsigned.hap` 生成；camera 相关文件零告警 |
| 相册选图/取消/失败路径 | 代码路径完整，待模拟器/真机运行验证 |
| 相机预览/拍照/切换/生命周期 | 待模拟器/真机运行验证 |

## 5. 环境

- DevEco SDK API 26.0.0.105（`/Applications/DevEco-Studio.app/Contents/sdk`），工程 modelVersion/targetSdk 26.0.0、compatibleSdk 6.1.1(24)。
- 关键 API 均按 SDK 声明核对：`camera.getCameraManager`、`createSession<PhotoSession>(NORMAL_PHOTO)`、`createPhotoOutput(profile)`、`on('photoAvailable')`（`Photo.main: image.Image`）、`PhotoSession.getPhotoRotation()`、`PhotoViewPicker.select`、`image.createImageSource(fd/ArrayBuffer)`、`PixelMap.rotate/flip/readPixelsToBuffer`、`applicationStateChange`。

## 6. 待验证与已知限制

1. 全部相机路径待模拟器/真机运行验证：授权、预览、拍照解码方向、前后切换、重复进出、切后台恢复（应用内已按 `applicationStateChange` 释放并恢复）。
2. EXIF 5/7（翻转+旋转组合）按平台文档实现，实际样张罕见，待真机带方向照片验证。
3. `getPhotoRotation()` 无参形式（API 23+）依赖系统取设备方向；若目标设备行为异常，回退方案是传 window 角度，需 Agent 4 真机确认。
4. x86_64 模拟器若暴露虚拟摄像头，流程可用但未验证；无摄像头设备自动显示“未检测到可用摄像头”并保留相册入口。
5. `PhotoViewPicker` URI 授权语义在 SDK 声明中注明“永久授权但建议 getAssets”；当前按官方通用样例以 `fs.openSync` 直读，已实测构建通过，运行读取待设备确认。若个别设备拒绝直读，替代方案是 `photoAccessHelper.getAssets` 取 fd，改动仅限 `GalleryImageService`。
6. 拍照分辨率就近 1920×1080 选择；如后续识别精度需要更高分辨率，调整 `CameraCaptureService` 顶部常量即可。
7. `CameraCaptureService` 为单例单会话，与第一阶段单预览页面匹配；多预览并发不在本阶段范围。
