// 课程资料库与检索索引一致性核心（纯逻辑，不依赖 @kit，可在 Node.js 中测试）。
//
// 本模块承载两条一致性链路：
//   1. 写链路（KnowledgeWriteCoordinator）：
//      资料版本更新 + 旧片段删除 + 新片段插入由 KnowledgeWriteStore 的原子方法
//      在单个 RDB 事务中完成；只有事务提交成功后才通过 KnowledgeEventBus 发布
//      资料变更事件，回滚时检索模块不会收到脏事件。
//      所有写操作经互斥锁串行化，避免两个事务交错导致回滚互相牵连。
//   2. 同步链路（KnowledgeSyncCore）：
//      启动时先订阅增量事件、再全量同步真实数据库资料，消除「全量同步期间
//      发生的变更被遗漏」的竞态；增量事件携带片段，标题/来源/版本以事件提交
//      时从库中读到的当前值为准；删除墓碑阻止在途旧任务把已删资料重新写入索引。
//
// 文件边界说明：本文件为 .ts 且不 import 任何 .ts 之外的 ArkTS kit 模块，
// 因此可以被 tests/ 下的 Node.js 测试直接打包运行。

import { CourseDocument, KnowledgeSegment, DocumentChangeEvent } from '../model/Knowledge';
import { SegmentService } from './SegmentService';
import { KnowledgeEventBus, KnowledgeChangeListener } from './KnowledgeEventBus';

// ============================== 事务 ==============================

/** 支持事务的存储（HarmonyOS RdbStore 的 begin/commit/rollBack 为同步调用，这里以 Promise 形式对齐契约）。 */
export interface TransactionalStore {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollBack(): Promise<void>;
}

/**
 * 在单个事务中执行一组写操作。
 * fn 抛错时 rollBack 并原样抛出；成功时 commit。
 * 调用方（原子方法）内部使用，不得嵌套。
 */
export async function runInTransaction<T>(store: TransactionalStore, fn: () => Promise<T>): Promise<T> {
  await store.beginTransaction();
  try {
    const result: T = await fn();
    await store.commit();
    return result;
  } catch (e) {
    await store.rollBack();
    throw e;
  }
}

// ============================== 端口 ==============================

/** 写端口：由 store/KnowledgeStore.ts 实现（真实 RDB），测试中由内存假存储实现。 */
export interface KnowledgeWriteStore extends TransactionalStore {
  getDocument(id: string): Promise<CourseDocument | null>;
  /** 单事务：插入资料 + 写入全部片段 */
  createDocumentWithSegments(doc: CourseDocument, segs: KnowledgeSegment[]): Promise<void>;
  /** 单事务：更新资料（含 revision+1 后的值）+ 删除旧片段 + 写入新片段 */
  updateDocumentWithSegments(doc: CourseDocument, segs: KnowledgeSegment[]): Promise<void>;
  /** 单事务：删除资料 + 级联删除全部片段 */
  deleteDocumentCascade(id: string): Promise<void>;
}

/** 读/订阅端口：由 KnowledgeService 实现，同步桥只依赖此接口。 */
export interface KnowledgeGateway {
  ensureReady(): Promise<void>;
  listDocuments(): Promise<CourseDocument[]>;
  getDocument(id: string): Promise<CourseDocument | null>;
  getSegments(documentId: string, revision?: number): Promise<KnowledgeSegment[]>;
  subscribeChanges(listener: KnowledgeChangeListener): () => void;
}

/** 索引构建结果（与 service/types.ets 的 IndexBuildResult 对齐的最小契约）。 */
export interface IndexSyncOutcome {
  ok: boolean;
  message: string;
}

/**
 * 索引侧端口：KnowledgeIndexBridge.ets 中用适配器接到 IIndexSyncManager。
 * 标题/来源为必填——同步核心保证提交时从库中读取当前值，检索侧据此登记引用元信息。
 */
export interface IndexSyncSink {
  handleDocumentChanged(
    documentId: string,
    revision: number,
    segments: KnowledgeSegment[],
    onComplete: (result: IndexSyncOutcome) => void,
    documentTitle: string,
    source: string
  ): void;
  handleDocumentDeleted(documentId: string): void;
}

/** 日志端口：默认 console；设备侧由桥注入 hilog 实现。 */
export interface SyncLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

class ConsoleSyncLogger implements SyncLogger {
  info(msg: string): void {
    console.info(`[KnowledgeSync] ${msg}`);
  }
  warn(msg: string): void {
    console.warn(`[KnowledgeSync] ${msg}`);
  }
  error(msg: string): void {
    console.error(`[KnowledgeSync] ${msg}`);
  }
}

// ============================== 状态 ==============================

/** 同步桥生命周期：idle 未启动 / syncing 全量同步中 / ready 已就绪（订阅生效） / error 初始化失败可重试。 */
export type KnowledgeSyncState = 'idle' | 'syncing' | 'ready' | 'error';

export interface KnowledgeSyncStatus {
  state: KnowledgeSyncState;
  /** 本次全量同步发现的资料数 */
  totalDocuments: number;
  /** 已处理（提交或按新鲜度跳过）的资料数 */
  syncedDocuments: number;
  /** state=error 时的失败原因 */
  lastError: string;
}

// ============================== 写协调器 ==============================

function genDocId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 资料写协调器：切分 + 原子落库 + 提交后发事件。
 * KnowledgeService 的 create/update/delete 全部委托到此类。
 */
export class KnowledgeWriteCoordinator {
  private readonly store: KnowledgeWriteStore;
  private readonly segmentService: SegmentService;
  private readonly eventBus: KnowledgeEventBus;
  /** 写互斥锁：RDB 事务是连接级的，并发事务交错会导致回滚互相牵连，这里串行化所有写操作。 */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(store: KnowledgeWriteStore, segmentService: SegmentService, eventBus: KnowledgeEventBus) {
    this.store = store;
    this.segmentService = segmentService;
    this.eventBus = eventBus;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const previous: Promise<void> = this.writeQueue;
    let release: () => void = (): void => {};
    this.writeQueue = new Promise<void>((resolve: (value: void | PromiseLike<void>) => void): void => {
      release = (): void => {
        resolve();
      };
    });
    const run = async (): Promise<T> => {
      await previous;
      try {
        return await fn();
      } finally {
        release();
      }
    };
    return run();
  }

  /** 新增资料：切分 → 单事务落库 → 提交后发 created 事件。 */
  async createDocument(title: string, source: string, content: string): Promise<CourseDocument> {
    return this.enqueue(async (): Promise<CourseDocument> => {
      const now: number = Date.now();
      const doc: CourseDocument = {
        id: genDocId(),
        title: title,
        source: source,
        content: content,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      const segments: KnowledgeSegment[] = this.segmentService.split(doc.id, doc.revision, doc.content);
      await this.store.createDocumentWithSegments(doc, segments);
      // 事务提交成功后才发布事件；失败时异常上抛，检索模块无感知
      this.eventBus.emit({
        type: 'created',
        documentId: doc.id,
        revision: doc.revision,
        segments: segments,
        timestamp: now
      });
      return doc;
    });
  }

  /** 修改资料：revision+1 → 重切分 → 单事务替换 → 提交后发 updated 事件。 */
  async updateDocument(
    id: string,
    title: string,
    source: string,
    content: string
  ): Promise<CourseDocument | null> {
    return this.enqueue(async (): Promise<CourseDocument | null> => {
      const existing: CourseDocument | null = await this.store.getDocument(id);
      if (!existing) {
        return null;
      }
      const previousRevision: number = existing.revision;
      const now: number = Date.now();
      const updated: CourseDocument = {
        id: existing.id,
        title: title,
        source: source,
        content: content,
        revision: previousRevision + 1,
        createdAt: existing.createdAt,
        updatedAt: now
      };
      const segments: KnowledgeSegment[] = this.segmentService.split(updated.id, updated.revision, updated.content);
      await this.store.updateDocumentWithSegments(updated, segments);
      this.eventBus.emit({
        type: 'updated',
        documentId: updated.id,
        revision: updated.revision,
        previousRevision: previousRevision,
        segments: segments,
        timestamp: now
      });
      return updated;
    });
  }

  /** 删除资料：单事务级联删除片段 → 提交后发 deleted 事件。 */
  async deleteDocument(id: string): Promise<boolean> {
    return this.enqueue(async (): Promise<boolean> => {
      const existing: CourseDocument | null = await this.store.getDocument(id);
      if (!existing) {
        return false;
      }
      await this.store.deleteDocumentCascade(id);
      this.eventBus.emit({
        type: 'deleted',
        documentId: id,
        revision: existing.revision,
        segments: [],
        timestamp: Date.now()
      });
      return true;
    });
  }
}

// ============================== 同步核心 ==============================

/**
 * 资料库 → 检索索引的同步核心。
 *
 * 竞态与一致性设计：
 *  a) start() 先 subscribeChanges 再全量同步。此后任何写操作的事务提交都会同步触发
 *     事件监听器，先更新 latestEventRevision，全量同步据此跳过已被事件覆盖的资料，
 *     杜绝「全量读到旧快照、变更事件被遗漏」的窗口。
 *  b) 全量同步对每份资料重新 getDocument（而非用列表快照），并在每个 await 之后
 *     重新校验新鲜度；切片按读到的当前 revision 精确查询。
 *  c) created/updated 事件提交前执行三重校验：资料仍存在 / 未被删除墓碑覆盖 /
 *     库中当前 revision 仍等于事件 revision（否则由更新的事件负责提交）。
 *  d) deleted 事件同步转发 handleDocumentDeleted 并留下墓碑（deletedRevision），
 *     任何 revision ≤ 墓碑的在途提交一律丢弃，防止删除后旧任务恢复该资料。
 *     资料 ID 全局唯一不复用；同名 ID 的 created 事件会清除墓碑。
 *  e) 索引侧另有 generation + revision 双重校验（IndexSyncManager）与向量库
 *     revision 保护（MemoryVectorStore），与本核心构成三道防线。
 */
export class KnowledgeSyncCore {
  private readonly knowledge: KnowledgeGateway;
  private readonly sink: IndexSyncSink;
  private readonly logger: SyncLogger;

  private status: KnowledgeSyncStatus = { state: 'idle', totalDocuments: 0, syncedDocuments: 0, lastError: '' };
  private readonly statusListeners: Set<(s: KnowledgeSyncStatus) => void> = new Set();
  private unsubscribe: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;

  /** 最新已收到事件的 revision（事件监听器中同步更新） */
  private readonly latestEventRevision: Map<string, number> = new Map();
  /** 已提交给索引侧的 revision */
  private readonly submittedRevision: Map<string, number> = new Map();
  /** 删除墓碑：documentId → 删除时的 revision */
  private readonly deletedRevision: Map<string, number> = new Map();

  constructor(knowledge: KnowledgeGateway, sink: IndexSyncSink, logger?: SyncLogger) {
    this.knowledge = knowledge;
    this.sink = sink;
    this.logger = logger ?? new ConsoleSyncLogger();
  }

  // ----- 状态接口（供问答页/KnowledgeRuntime 使用） -----

  getStatus(): KnowledgeSyncStatus {
    return {
      state: this.status.state,
      totalDocuments: this.status.totalDocuments,
      syncedDocuments: this.status.syncedDocuments,
      lastError: this.status.lastError
    };
  }

  /** 订阅状态变化；立即回调一次当前状态。返回退订函数。 */
  onStatus(cb: (s: KnowledgeSyncStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.getStatus());
    return (): void => {
      this.statusListeners.delete(cb);
    };
  }

  isReady(): boolean {
    return this.status.state === 'ready';
  }

  // ----- 生命周期 -----

  /**
   * 启动同步：全量 + 订阅增量。幂等，并发调用共享同一 Promise。
   * 失败时不抛异常，状态置为 error（lastError 记录原因），调用方可观察状态后调用 retry()。
   */
  start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }
    if (this.status.state === 'ready') {
      return Promise.resolve();
    }
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  /** 失败后重试：重置并重新执行全量同步（全量读库自愈合）。 */
  async retry(): Promise<void> {
    this.stop();
    await this.start();
  }

  /** 停止：退订增量事件、清空同步簿记，状态回到 idle。不清理索引侧已建数据。 */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.startPromise = null;
    this.latestEventRevision.clear();
    this.submittedRevision.clear();
    this.deletedRevision.clear();
    this.setStatus('idle', 0, 0, '');
  }

  private async doStart(): Promise<void> {
    this.setStatus('syncing', 0, 0, '');
    try {
      await this.knowledge.ensureReady();
      // 关键顺序：先订阅，再全量同步。订阅与上一个 await 之间无悬挂点，
      // 此后任何事务提交都会同步进入 handleChange，不会遗漏。
      this.unsubscribe = this.knowledge.subscribeChanges((event: DocumentChangeEvent): void => {
        this.handleChange(event);
      });

      const docs: CourseDocument[] = await this.knowledge.listDocuments();
      this.setStatus('syncing', docs.length, 0, '');
      for (const listed of docs) {
        await this.syncFromStore(listed.id);
        this.setStatus('syncing', docs.length, this.status.syncedDocuments + 1, '');
      }
      this.setStatus('ready', docs.length, docs.length, '');
      this.logger.info(`full sync completed, ${docs.length} documents processed`);
    } catch (e) {
      const msg: string = e instanceof Error ? e.message : String(e);
      this.startPromise = null;
      this.setStatus('error', this.status.totalDocuments, this.status.syncedDocuments, msg);
      this.logger.error(`sync failed: ${msg}`);
    }
  }

  /** 全量同步单份资料：以库里当前值为准，被更新事件覆盖或被删除的跳过。 */
  private async syncFromStore(documentId: string): Promise<void> {
    const fresh: CourseDocument | null = await this.knowledge.getDocument(documentId);
    if (!fresh) {
      return; // 同步期间已删除；deleted 事件已同步转发索引清理
    }
    if (this.isEventCovered(fresh.id, fresh.revision)) {
      return; // 订阅期间已有同版或更新事件，由事件路径提交
    }
    const segments: KnowledgeSegment[] = await this.knowledge.getSegments(fresh.id, fresh.revision);
    // await 期间可能发生变更/删除：提交前再次校验
    if (this.isEventCovered(fresh.id, fresh.revision) || this.isTombstoned(fresh.id, fresh.revision)) {
      return;
    }
    this.submit(fresh.id, fresh.revision, segments, fresh.title, fresh.source);
  }

  private handleChange(event: DocumentChangeEvent): void {
    switch (event.type) {
      case 'created':
        this.deletedRevision.delete(event.documentId);
        this.latestEventRevision.set(event.documentId, event.revision);
        void this.forwardUpsert(event);
        break;
      case 'updated':
        this.latestEventRevision.set(event.documentId, event.revision);
        void this.forwardUpsert(event);
        break;
      case 'deleted':
        this.latestEventRevision.delete(event.documentId);
        this.submittedRevision.delete(event.documentId);
        this.deletedRevision.set(event.documentId, event.revision);
        this.sink.handleDocumentDeleted(event.documentId);
        this.logger.info(`index cleared for deleted document ${event.documentId}`);
        break;
    }
  }

  /** 转发新增/更新：片段取自事件（与事务同源），标题/来源/版本以库中当前值为准。 */
  private async forwardUpsert(event: DocumentChangeEvent): Promise<void> {
    try {
      const doc: CourseDocument | null = await this.knowledge.getDocument(event.documentId);
      if (!doc) {
        // 事件后资料被删除（deleted 事件随后会到，这里防御性再清一次，幂等）
        this.sink.handleDocumentDeleted(event.documentId);
        return;
      }
      if (this.isTombstoned(event.documentId, event.revision)) {
        return; // 删除先于本次转发到达
      }
      if (doc.revision !== event.revision) {
        return; // 已有更新的事件，由更新事件负责提交
      }
      this.submit(doc.id, doc.revision, event.segments, doc.title, doc.source);
    } catch (e) {
      const msg: string = e instanceof Error ? e.message : String(e);
      this.logger.error(`forward ${event.type} failed for ${event.documentId}: ${msg}`);
    }
  }

  private isEventCovered(documentId: string, revision: number): boolean {
    const ev: number | undefined = this.latestEventRevision.get(documentId);
    return ev !== undefined && ev >= revision;
  }

  private isTombstoned(documentId: string, revision: number): boolean {
    const del: number | undefined = this.deletedRevision.get(documentId);
    return del !== undefined && del >= revision;
  }

  private submit(
    documentId: string,
    revision: number,
    segments: KnowledgeSegment[],
    title: string,
    source: string
  ): void {
    this.submittedRevision.set(documentId, revision);
    this.sink.handleDocumentChanged(
      documentId,
      revision,
      segments,
      (result: IndexSyncOutcome): void => {
        if (!result.ok) {
          this.logger.warn(`index build failed for ${documentId} rev ${revision}: ${result.message}`);
        }
      },
      title,
      source
    );
  }

  private setStatus(state: KnowledgeSyncState, total: number, synced: number, lastError: string): void {
    this.status = { state: state, totalDocuments: total, syncedDocuments: synced, lastError: lastError };
    const snapshot: KnowledgeSyncStatus = this.getStatus();
    for (const cb of this.statusListeners) {
      try {
        cb(snapshot);
      } catch (_e) {
        // 单个监听器异常不影响其他监听器
      }
    }
  }
}
