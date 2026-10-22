import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { fileIo } from '@kit.CoreFileKit';
import { RecordService } from '../services/storage/RecordService';
import { RecognitionService } from '../services/inference/RecognitionService';
import * as NativeBridge from '../services/inference/NativeInferenceBridge';
import { SyncManager } from '../services/sync/SyncManager';

const TAG: string = 'SmartItemApp';
const DOMAIN: number = 0x0000;

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate start');

    void RecordService.getInstance().initialize(this.context).then((result) => {
      hilog.info(DOMAIN, TAG, 'RecordService init ok=%{public}s', result.initialized ? 'true' : 'false');
    }).catch((e: Error) => {
      hilog.warn(DOMAIN, TAG, 'RecordService init exception: %{public}s', e.message);
    });

    // RecognitionService.initialize() 内部：ABI 检查 → 模型沙箱拷贝+hash → NativeBridge.initNative()
    RecognitionService.getInstance().setContext(this.context);
    void RecognitionService.getInstance().initialize().then((avail) => {
      hilog.info(DOMAIN, TAG, 'RecognitionService init available=%{public}s', avail.available ? 'true' : 'false');
      if (!avail.available && avail.error) {
        hilog.warn(DOMAIN, TAG, '模型不可用: %{public}s', avail.error.message);
      }
    }).catch((e: Error) => {
      hilog.error(DOMAIN, TAG, 'RecognitionService init exception: %{public}s', e.message);
    });

    // 第三阶段同步层：初始化 SyncManager（Preferences + Network listener + 启动后 flush 遗留队列）
    void SyncManager.getInstance().initialize(this.context).then(() => {
      hilog.info(DOMAIN, TAG, 'SyncManager init ok');
    }).catch((e: Error) => {
      // 同步层失败不阻塞应用主流程
      hilog.warn(DOMAIN, TAG, 'SyncManager init exception: %{public}s', e.message);
    });

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'Load page failed: %{public}s', err.message);
      } else {
        hilog.info(DOMAIN, TAG, 'loadContent success');
      }
    });

    // 开发验证用：rawfile/benchmark_trigger.txt 或 /data/local/tmp/benchmark_trigger.txt 触发完整推理 benchmark
    void this.maybeRunBenchmark();
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onDestroy');
    NativeBridge.disposeNative();
    void RecordService.getInstance().dispose();
    void RecognitionService.getInstance().dispose();
    SyncManager.getInstance().dispose();
  }

  private async maybeRunBenchmark(): Promise<void> {
    try {
      let triggered = false;

      try {
        await this.context.resourceManager.getRawFileContent('benchmark_trigger.txt');
        triggered = true;
      } catch (e) { /* no */ }

      if (!triggered) {
        const p = '/data/local/tmp/benchmark_trigger.txt';
        try {
          const access = await fileIo.access(p);
          if (access) { triggered = true; }
        } catch (e) { /* no */ }
      }

      if (!triggered) return;

      hilog.info(DOMAIN, TAG, 'importing BenchmarkRunner...');
      const mod = await import('../services/inference/BenchmarkRunner');
      hilog.info(DOMAIN, TAG, 'import ok, running benchmark');
      await mod.runBenchmark(this.context);
      hilog.info(DOMAIN, TAG, 'benchmark done');
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'benchmark crash: %{public}s', (e as Error).message);
    }
  }
}
