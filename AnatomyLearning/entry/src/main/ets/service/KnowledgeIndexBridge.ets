// 资料模块（Agent C）与检索模块（Agent D）之间的索引同步桥。
//
// 本文件是薄适配层：把 KnowledgeService（KnowledgeGateway）与
// IndexSyncManager（IIndexSyncManager）接到 KnowledgeSyncCore 上。
// 全部同步逻辑（先订阅后全量、新鲜度校验、删除墓碑、状态机）在
// KnowledgeSyncCore.ts 中，纯逻辑可在 Node.js 里直接测试。
//
// 索引更新协议（与 Agent D 约定）：
//   - created/updated → IndexSyncManager.handleDocumentChanged(docId, revision, segments, onComplete, title, source)
//     事件携带与事务同源的新版本片段；标题/来源/版本以提交时库中当前值为准。
//   - deleted         → IndexSyncManager.handleDocumentDeleted(docId)
//     墓碑阻止在途旧任务在删除后恢复该资料。
//   - 全量重建        → start() 先订阅增量再逐资料读取当前版本提交。
//
// 状态接口（供问答页 / KnowledgeRuntime 使用）：
//   getStatus() / onStatus(cb) / isReady() / start()（幂等）/ retry() / stop()

import { hilog } from '@kit.PerformanceAnalysisKit';
import { IIndexSyncManager, IndexBuildResult } from './types';
import { KnowledgeSegment } from '../model/Knowledge';
import {
  KnowledgeGateway, KnowledgeSyncCore, KnowledgeSyncStatus,
  IndexSyncSink, IndexSyncOutcome, SyncLogger
} from './KnowledgeSyncCore';

const TAG = 'KnowledgeIndexBridge';

/** 把 Agent D 的 IndexSyncManager 适配成同步核心的 IndexSyncSink。 */
class IndexSyncManagerAdapter implements IndexSyncSink {
  private readonly target: IIndexSyncManager;

  constructor(target: IIndexSyncManager) {
    this.target = target;
  }

  handleDocumentChanged(
    documentId: string,
    revision: number,
    segments: KnowledgeSegment[],
    onComplete: (result: IndexSyncOutcome) => void,
    documentTitle: string,
    source: string
  ): void {
    this.target.handleDocumentChanged(
      documentId,
      revision,
      segments,
      (result: IndexBuildResult): void => {
        const outcome: IndexSyncOutcome = { ok: result.ok, message: result.message ?? '' };
        onComplete(outcome);
      },
      documentTitle,
      source
    );
  }

  handleDocumentDeleted(documentId: string): void {
    this.target.handleDocumentDeleted(documentId);
  }
}

/** 设备侧日志：转发到 hilog。 */
class HilogSyncLogger implements SyncLogger {
  info(msg: string): void {
    hilog.info(0x0000, TAG, '%{public}s', msg);
  }
  warn(msg: string): void {
    hilog.warn(0x0000, TAG, '%{public}s', msg);
  }
  error(msg: string): void {
    hilog.error(0x0000, TAG, '%{public}s', msg);
  }
}

export class KnowledgeIndexBridge {
  private readonly core: KnowledgeSyncCore;

  constructor(knowledge: KnowledgeGateway, indexManager: IIndexSyncManager) {
    this.core = new KnowledgeSyncCore(knowledge, new IndexSyncManagerAdapter(indexManager), new HilogSyncLogger());
  }

  /**
   * 启动桥接：订阅增量变更 + 全量同步真实数据库资料。
   * 幂等，并发调用共享同一 Promise。
   * 失败不抛异常：getStatus().state === 'error'，可调用 retry() 重试。
   */
  async start(): Promise<void> {
    await this.core.start();
  }

  /** 失败/异常后重试：重置并重新全量同步（全量读库自愈合）。 */
  async retry(): Promise<void> {
    await this.core.retry();
  }

  /** 停止：退订增量事件，状态回到 idle（保留索引侧数据，供页面级释放时保持索引热度）。 */
  stop(): void {
    this.core.stop();
  }

  /** 当前同步状态（初始化/就绪/失败）。 */
  getStatus(): KnowledgeSyncStatus {
    return this.core.getStatus();
  }

  /** 索引是否就绪（全量同步完成且增量订阅生效）。 */
  isReady(): boolean {
    return this.core.isReady();
  }

  /** 订阅状态变化，立即回调一次当前状态。返回退订函数。 */
  onStatus(cb: (status: KnowledgeSyncStatus) => void): () => void {
    return this.core.onStatus(cb);
  }
}
