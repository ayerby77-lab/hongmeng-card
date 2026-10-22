/**
 * Native real inference benchmark — 完整链路验证。
 *
 * 流程：
 *   1. RecognitionService.initialize() — 模型沙箱 + native session
 *   2. 读取测试图 → preprocess → NativeBridge.runNative → postprocess
 *   3. 对比输出 box 数量、类别、置信度
 *
 * 触发条件：/data/local/tmp/benchmark_trigger.txt 存在
 * 跑完自动删除 trigger。
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { common } from '@kit.AbilityKit';
import { image } from '@kit.ImageKit';
import { fileIo } from '@kit.CoreFileKit';

import { RecognitionService } from './RecognitionService';
import * as NativeBridge from './NativeInferenceBridge';
import { InferenceEngine } from './InferenceEngine';
import { MODEL_OUTPUT_BYTES, MODEL_INFO } from '../../models/ModelConstants';
import { PixelFormat as BizPixelFormat, ImageSource, ImageOrigin } from '../../models/ImageTypes';
import { InferenceExecutionMode } from '../../models/DetectionTypes';

const TAG: string = 'BenchmarkRunner';
const DOMAIN: number = 0x0004;

/** 从文件路径创建 ImageSource（RGB 紧密排列）。 */
async function loadRgbImage(path: string): Promise<ImageSource | null> {
  try {
    const imgSource = await image.createImageSource(path);
    const info = await imgSource.getImageInfo();
    const w = info.size.width;
    const h = info.size.height;
    const opts: image.DecodingOptions = { desiredSize: { width: w, height: h }, index: 0 };
    const pixelMap = await imgSource.createPixelMap(opts);
    const bufSize = pixelMap.getPixelBytesNumber();
    const rgbaBuf = new ArrayBuffer(bufSize);
    pixelMap.readPixelsToBufferSync(rgbaBuf);
    pixelMap.release();
    imgSource.release();

    // 统一转 RGB
    const rgba = new Uint8Array(rgbaBuf);
    const rgbBuf = new ArrayBuffer(w * h * 3);
    const rgb = new Uint8Array(rgbBuf);
    // 尝试推断 bytesPerPixel：用前 4 字节是否对称简单判断
    const bpp = (bufSize === w * h * 4) ? 4 : 3;
    for (let i = 0; i < w * h; i++) {
      const offset = i * bpp;
      rgb[i * 3] = rgba[offset];
      rgb[i * 3 + 1] = rgba[offset + 1];
      rgb[i * 3 + 2] = rgba[offset + 2];
    }

    return {
      imageId: path.split('/').pop() ?? path,
      origin: ImageOrigin.GALLERY,
      width: w,
      height: h,
      pixelFormat: BizPixelFormat.RGB_888,
      rowStride: w * 3,
      data: rgbBuf,
      isMirrored: false,
      exifOrientation: 0,
      capturedAtMs: Date.now()
    };
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'loadRgbImage %{public}s fail: %{public}s', path, (e as Error).message);
    return null;
  }
}

export async function runBenchmark(context: common.Context): Promise<void> {
  hilog.info(DOMAIN, TAG, '===== Native Real Inference Benchmark =====');

  // 1. 初始化
  const recognition = RecognitionService.getInstance();
  recognition.setContext(context);
  const avail = await recognition.initialize();
  hilog.info(DOMAIN, TAG, 'initialize ok=%{public}s', avail.available ? 'true' : 'false');
  if (!avail.available) {
    hilog.error(DOMAIN, TAG, 'SKIP: 模型不可用');
    return;
  }

  // 2. 找测试图：先看 /data/local/tmp/test_image.jpg，再看 rawfile/benchmark_images/
  let imagePath: string = '/data/local/tmp/test_image.jpg';
  let exists = false;
  try { exists = await fileIo.access(imagePath); } catch (e) { /* no */ }
  if (!exists) {
    try {
      const list = await context.resourceManager.getRawFileList('benchmark_images');
      if (list.length > 0) {
        // 找第一个 jpg/png
        const name = list.find((n: string) =>
          n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png'));
        if (name) {
          const view = await context.resourceManager.getRawFileContent(`benchmark_images/${name}`);
          imagePath = `${context.filesDir}/bench_${name}`;
          const file = fileIo.openSync(imagePath,
            fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
          const tmp = new Uint8Array(view.byteLength);
          tmp.set(view);
          fileIo.writeSync(file.fd, tmp.buffer as ArrayBuffer,
            { offset: tmp.byteOffset, length: tmp.byteLength });
          fileIo.closeSync(file);
          exists = true;
          hilog.info(DOMAIN, TAG, '从 rawfile 加载测试图 %{public}s', name);
        }
      }
    } catch (e) { /* no */ }
  }

  if (!exists) {
    hilog.warn(DOMAIN, TAG, '未找到测试图，跳过 benchmark');
    hilog.info(DOMAIN, TAG, '===== Benchmark Complete (no image) =====');
    return;
  }

  hilog.info(DOMAIN, TAG, '测试图路径: %{public}s', imagePath);

  // 3. 加载 + 推理
  const src = await loadRgbImage(imagePath);
  if (src === null) {
    hilog.error(DOMAIN, TAG, '加载测试图失败');
    return;
  }

  hilog.info(DOMAIN, TAG, '图像: %{public}sx%{public}s, rowStride=%{public}d',
    src.width, src.height, src.rowStride);

  // 4. 跑完整链路（同步模式）
  try {
    const t0 = Date.now();
    const preprocess = InferenceEngine.preprocess(
      src.data, src.rowStride, src.width, src.height, src.pixelFormat,
      MODEL_INFO.inputWidth, MODEL_INFO.inputHeight
    );
    const t1 = Date.now();

    const inputBuf = preprocess.tensor.buffer as ArrayBuffer;
    const outBuf = NativeBridge.runNative(
      inputBuf,
      [1, 3, MODEL_INFO.inputHeight, MODEL_INFO.inputWidth],
      MODEL_INFO.inputName, MODEL_INFO.outputName, MODEL_OUTPUT_BYTES
    );
    const t2 = Date.now();

    // 验证输出大小
    const outFloats = outBuf.byteLength / 4;
    const expected = 84 * 8400;
    hilog.info(DOMAIN, TAG, 'nativeRun 输出: %{public}d floats (期望 %{public}d)',
      outFloats, expected);

    const boxes = InferenceEngine.postprocess(
      outBuf, preprocess.letterbox, src.width, src.height,
      8400, MODEL_INFO.classCount,
      { confidenceThreshold: 0.25, iouThreshold: 0.7, maxDetections: 300,
        executionMode: InferenceExecutionMode.SYNC }
    );
    const t3 = Date.now();

    hilog.info(DOMAIN, TAG, '===== INFERENCE RESULT =====');
    hilog.info(DOMAIN, TAG,
      'RESULT|preMs=%{public}d|inferMs=%{public}d|postMs=%{public}d|totalMs=%{public}d|boxes=%{public}d',
      t1 - t0, t2 - t1, t3 - t2, t3 - t0, boxes.length);
    for (let i = 0; i < boxes.length && i < 20; i++) {
      const b = boxes[i];
      hilog.info(DOMAIN, TAG,
        'BOX|%{public}d|class=%{public}d|label=%{public}s|conf=%.3f|left=%.1f|top=%.1f|right=%.1f|bottom=%.1f',
        i, b.classId, b.label, b.confidence, b.left, b.top, b.right, b.bottom);
    }
    hilog.info(DOMAIN, TAG, '===== INFERENCE COMPLETE =====');
  } catch (e) {
    hilog.error(DOMAIN, TAG, '推理异常: %{public}s', (e as Error).message);
  }
}
