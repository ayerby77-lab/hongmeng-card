# 第三阶段 云端同步 最小接口契约

> 本阶段聚焦"记录上传 + 云端查询 + 模型更新"三条链路的客户端侧契约。后端实现按 `api-plan.md`；客户端侧新增 `services/network/`（HTTP 封装 + JWT）与 `services/sync/`（上传队列、幂等）。Agent 0 冻结。

## 1. 鉴权：JWT

### 1.1 设备注册与 token 换取

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/auth/token` | 首次鉴权：设备标识（`deviceId`，UUID + 首次启动生成并持久化）+ 客户端内嵌密钥换短期 access token + 长期 refresh token |
| POST | `/api/v1/auth/refresh` | access token 过期（HTTP 401）时，用 refresh token 换新 token pair |

**token 存储**：`AppStorage` 或 Preferences。**密钥不进 RDB**，仅在 `auth/token` 请求体中使用。

### 1.2 请求体（`auth/token`）

```json
{
  "deviceId": "d4f3a2b1-...",
  "clientKey": "内置，生产构建注入"
}
```

### 1.3 响应体

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAtMs": 1792630992345
}
```

### 1.4 统一鉴权失败处理

- HTTP 401：`network/HttpClient` 自动用 refresh token 重试一次；仍 401 → 清空 token，UI 提示"登录已过期，需要重新授权"
- HTTP 403：设备未注册 / 密钥无效 → UI 提示并引导重新扫码或联系管理员

## 2. 模型版本检查与下载

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/models/latest` | 客户端带 `sha256` + `modelId` 查询是否有新版本 |
| GET | `/api/v1/models/{version}/download` | 服务端返回文件流，客户端直接写到 `cacheDir/models/`，完整下载完成后 `fs.renameSync` 进 `filesDir/models/`，然后通知 `RecognitionService` 重新初始化 |

**版本判断**：返回 `{ hasUpdate: false }` 时跳过下载；`hasUpdate: true` 时返回 `downloadUrl` + `sha256` + `modelId` + `reason`（`bugfix` / `accuracy` / `compat`）。

**原子替换**：先写 `cacheDir/models/{modelId}-{sha256}.downloading` → 校验 SHA-256 → `rename` 到 `filesDir/models/{modelId}.onnx`（同名覆盖，ArkTS 侧 `fs.unlinkSync` + `renameSync` 原子序列）。替换期间旧模型仍可用；新模型写好 `RecognitionService.dispose()` + `initialize()`。

**失败回退**：下载中断 / hash 不符 → 删除 `.downloading` 文件，保留旧模型，记录日志。

## 3. 记录批量上传（幂等）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/records/batch` | 按 `recordId` 幂等批量上传；每批最多 50 条；响应逐条返回 `created` / `duplicate` / `conflict` / `invalid` |

### 3.1 请求体（与 `api-plan.md` 第 3 节对齐）

```json
{
  "schemaVersion": 1,
  "records": [
    {
      "schemaVersion": 1,
      "recordId": "rec_1792630992345_a3f2",
      "capturedAtMs": 1792630992345,
      "recognizedAtMs": 1792631000781,
      "editedAtMs": null,
      "imageWidth": 810,
      "imageHeight": 1080,
      "imageOrigin": "gallery",
      "modelId": "yolov13n-coco-640-opset18",
      "modelSha256": "f39e5a3b1763423b1e60769e81b08a5da012677dce0248f4b4a95c5ad5cb799b",
      "executionMode": "taskpool",
      "totalMs": 154,
      "coldStart": false,
      "boxes": [
        { "classId": 0, "label": "person", "confidence": 0.937, "left": 12.3, "top": 45.6, "right": 89.1, "bottom": 489.2 },
        ...
      ],
      "counts": [ { "classId": 0, "count": 4 }, ... ]
    }
  ]
}
```

### 3.2 幂等语义

- 服务端以 `(deviceId, recordId)` 唯一约束
- `recordId` + 规范化载荷完全相同 → 响应 `status=duplicate`（视为上传成功）
- `recordId` 已存在但载荷不同 → `status=conflict`（客户端标记"冲突待用户确认"）
- `invalid` → 字段缺失 / schemaVersion 不匹配（客户端标记"永久失败"）

### 3.3 客户端 services/sync/ 队列接口

```ts
// services/sync/SyncQueue.ets（Agent 4 或后续实现）
interface SyncQueueApi {
  /** 入队一条记录上传；幂等（同 recordId 多次调用只入队一次）。 */
  enqueue(recordId: string): void;
  /** 手动触发上传（如"同步"按钮）。返回成功上传的 recordId 列表。 */
  flush(): Promise<string[]>;
  /** RDB 中标记"已上传/冲突/永久失败"状态供列表展示。 */
  getStatus(recordId: string): SyncStatus;
  /** 启动时扫描 RDB 未上传记录入队。 */
  requeueStale(): void;
}
enum SyncStatus { PENDING, UPLOADED, CONFLICT, FAILED }
```

**触发时机**：`RecordService.save()` 成功 → 自动 `syncQueue.enqueue(recordId)`；用户点"同步"→ `flush()`；应用启动 → `requeueStale()`。

**重试策略**：队列内每条记录最多重试 3 次，指数退避（5s / 30s / 5min）；3 次失败转为 FAILED，等用户手动重试。

## 4. 云端历史查询

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/records` | `fromMs` / `toMs` / `classId` / `page` / `pageSize` 参数；返回 `RecordPage`（同 phase-2-contract） |
| GET | `/api/v1/records/{recordId}` | 返回完整 `RecordDetail`（含 boxes） |
| GET | `/api/v1/statistics` | `fromMs` / `toMs` / `groupBy=class|day|model`；返回统计聚合 |

**客户端侧**：云端查询走独立 `CloudRecordService`（实现 RecordServiceApi 子集），UI 用同一个接口契约消费，列表/详情页可切换本地与云端数据源。

## 5. 客户端模块边界

| 路径 | 所有者 | 职责 |
| --- | --- | --- |
| `services/network/HttpClient.ets` | Agent 4 | 通用 HTTP 封装：Bearer 鉴权、401 自动 refresh 重试、超时、错误码映射 |
| `services/network/AuthStore.ets` | Agent 4 | token 持久化、刷新、密钥注入（构建时注入） |
| `services/network/ModelUpdate.ets` | Agent 2 | 版本查询、原子下载替换、SHA-256 校验、触发 RecognitionService 重新初始化 |
| `services/sync/SyncQueue.ets` | Agent 4 | 上传队列（内存 + RDB 状态标记）、幂等去重、重试、flush |
| `services/sync/CloudRecordService.ets` | Agent 4 | 实现 RecordServiceApi 的 list/getDetail/delete（云端版本） |
| `services/sync/Uploader.ets` | Agent 4 | 组装请求体、批量上传、逐记录处理响应、更新 RDB 同步状态 |
| `models/RecordTypes.ets` | Agent 0 | **扩展**：`SyncStatus` 枚举；`RecordSummary` / `RecordDetail` 增加可选 `syncStatus: SyncStatus`；`RecordServiceApi` 扩展 `cloudList/cloudGetDetail`（云端专用） |

## 6. 构建安全

- 客户端密钥 **不进源码**，由 build profile 的 `hvigorProperties` 注入，打包时写入 HAP 的 `native` 配置或加密进 Preferences 默认值
- 云端历史查询与上传在 RDB 记录行增加 `cloud_synced INTEGER DEFAULT 0` / `cloud_conflict INTEGER DEFAULT 0` / `cloud_last_attempt_ms INTEGER DEFAULT 0` 三列（后续迁移；phase-2 schema v1 不含）

## 7. 验证顺序

1. 先实现 `services/network/HttpClient` + `AuthStore`：`POST /health` 改为带 token 请求，验证鉴权链路
2. 模型更新独立走：下载替换 → SHA-256 校验 → 冷启动新模型，不依赖同步队列
3. 记录上传最后：需先有稳定的第二阶段 RDB 存储 + 队列状态标记
4. 云端查询仅当有后端实现时接入；后端未就绪前 `CloudRecordService` 返回明确 "UNAVAILABLE" 错误码，UI 自动降级到本地

---

## 附：请求体 schemaVersion 策略

客户端首次发 `schemaVersion: 1`；后端拒绝未知版本（HTTP 422）并在错误体返回 `serverSchemaVersion`。客户端据此决定：升级本地 schema → 下次上传新版本载荷；或提示用户更新应用。本阶段固定 schemaVersion=1，不做向后兼容。
