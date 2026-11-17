// 课程资料库 ↔ 检索索引一致性测试。
//
// 覆盖（对应任务验收项）：
//   A. runInTransaction 事务编排（commit/rollback 调用时序）
//   B. 写协调器 + 事务存储：更新中途失败全量回滚、新增/删除原子性、并发写串行化、提交后才发事件
//   C. 索引一致性（使用真实的 IndexSyncManager / MemoryVectorStore / HybridRetrievalService）：
//      全量同步、增量新增/修改/删除、旧版本退出检索、删除后在途任务不得恢复、
//      启动全量同步与增量事件竞态、索引中保留正确的标题/来源/版本
//   D. 同步桥状态机：idle/syncing/ready/error、retry、幂等 start、stop 退订
//
// 运行方式（.ets 源文件需 esbuild 打包后用 Node 执行）：
//   npx esbuild tests/knowledge-consistency.test.ts --bundle --platform=node --format=esm \
//     --loader:.ets=ts --resolve-extensions=.ts,.ets,.js --outfile=/tmp/knowledge-consistency.test.mjs
//   node /tmp/knowledge-consistency.test.mjs

import {
  KnowledgeWriteCoordinator, KnowledgeSyncCore, runInTransaction,
  KnowledgeWriteStore, KnowledgeGateway, IndexSyncSink, IndexSyncOutcome,
  KnowledgeSyncStatus
} from '../entry/src/main/ets/service/KnowledgeSyncCore';
import { SegmentService } from '../entry/src/main/ets/service/SegmentService';
import { KnowledgeEventBus, KnowledgeChangeListener } from '../entry/src/main/ets/service/KnowledgeEventBus';
import { CourseDocument, KnowledgeSegment } from '../entry/src/main/ets/model/Knowledge';
import { IndexSyncManager } from '../entry/src/main/ets/service/index/IndexSyncManager';
import { MemoryVectorStore } from '../entry/src/main/ets/service/embedding/MemoryVectorStore';
import { HybridRetrievalService } from '../entry/src/main/ets/service/retrieval/HybridRetrievalService';
import { TestEmbeddingService } from '../entry/src/main/ets/service/embedding/TestEmbeddingService';
import {
  EmbeddingRequest, EmbeddingResult, IndexBuildResult,
  ServiceException, ServiceError
} from '../entry/src/main/ets/service/types';

// ---------- 测试小框架 ----------
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待异步索引任务链（事件转发 → embedding → upsert）全部落地 */
async function flush(rounds: number = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await delay(2);
  }
}

// ---------- 假事务存储（模拟 RDB：事务内快照，commit 生效 / rollBack 还原） ----------
class FakeKnowledgeStore implements KnowledgeWriteStore {
  private docs: Map<string, CourseDocument> = new Map();
  private segs: Map<string, KnowledgeSegment[]> = new Map();
  private docsSnap: Map<string, CourseDocument> | null = null;
  private segsSnap: Map<string, KnowledgeSegment[]> | null = null;
  readonly opLog: string[] = [];
  private failAtSegment: number = -1;
  private segmentInsertCounter: number = 0;

  /** 让下一个事务在插入第 n 个片段（1 起）时失败 */
  failNextTransactionAtSegment(n: number): void {
    this.failAtSegment = n;
    this.segmentInsertCounter = 0;
  }

  beginTransaction(): Promise<void> {
    this.opLog.push('begin');
    this.docsSnap = this.cloneDocs();
    this.segsSnap = this.cloneSegs();
    return Promise.resolve();
  }

  commit(): Promise<void> {
    this.opLog.push('commit');
    this.docsSnap = null;
    this.segsSnap = null;
    return Promise.resolve();
  }

  rollBack(): Promise<void> {
    this.opLog.push('rollback');
    if (this.docsSnap) this.docs = this.docsSnap;
    if (this.segsSnap) this.segs = this.segsSnap;
    this.docsSnap = null;
    this.segsSnap = null;
    return Promise.resolve();
  }

  private cloneDocs(): Map<string, CourseDocument> {
    const m = new Map<string, CourseDocument>();
    this.docs.forEach((v, k) => m.set(k, { ...v }));
    return m;
  }

  private cloneSegs(): Map<string, KnowledgeSegment[]> {
    const m = new Map<string, KnowledgeSegment[]>();
    this.segs.forEach((v, k) => m.set(k, v.map((s) => ({ ...s }))));
    return m;
  }

  getDocument(id: string): Promise<CourseDocument | null> {
    const d = this.docs.get(id);
    return Promise.resolve(d ? { ...d } : null);
  }

  listDocuments(): Promise<CourseDocument[]> {
    return Promise.resolve(Array.from(this.docs.values()).map((d) => ({ ...d })));
  }

  getSegments(documentId: string, revision?: number): Promise<KnowledgeSegment[]> {
    const list = this.segs.get(documentId) ?? [];
    const filtered = revision === undefined ? list : list.filter((s) => s.documentRevision === revision);
    return Promise.resolve(filtered.map((s) => ({ ...s })));
  }

  createDocumentWithSegments(doc: CourseDocument, segments: KnowledgeSegment[]): Promise<void> {
    return runInTransaction(this, async (): Promise<void> => {
      this.opLog.push('insertDoc');
      this.docs.set(doc.id, { ...doc });
      await this.insertAll(segments);
    });
  }

  updateDocumentWithSegments(doc: CourseDocument, segments: KnowledgeSegment[]): Promise<void> {
    return runInTransaction(this, async (): Promise<void> => {
      this.opLog.push('updateDoc');
      this.docs.set(doc.id, { ...doc });
      this.opLog.push('deleteSegs');
      this.segs.set(doc.id, []);
      await this.insertAll(segments);
    });
  }

  deleteDocumentCascade(id: string): Promise<void> {
    return runInTransaction(this, async (): Promise<void> => {
      this.opLog.push('deleteDoc');
      this.docs.delete(id);
      this.opLog.push('deleteSegs');
      this.segs.delete(id);
    });
  }

  private insertAll(segments: KnowledgeSegment[]): Promise<void> {
    for (const seg of segments) {
      this.segmentInsertCounter++;
      this.opLog.push(`insertSeg:${seg.seqIndex}`);
      if (this.failAtSegment > 0 && this.segmentInsertCounter === this.failAtSegment) {
        this.failAtSegment = -1;
        return Promise.reject(new Error('injected segment write failure'));
      }
      const list = this.segs.get(seg.documentId) ?? [];
      list.push({ ...seg });
      this.segs.set(seg.documentId, list);
    }
    return Promise.resolve();
  }

  // ---- 测试辅助 ----
  allSegments(): KnowledgeSegment[] {
    const out: KnowledgeSegment[] = [];
    this.segs.forEach((list) => list.forEach((s) => out.push(s)));
    return out;
  }

  txnMarkers(): string[] {
    return this.opLog.filter((op) => op === 'begin' || op === 'commit' || op === 'rollback');
  }
}

// ---------- 假网关（读 + 订阅，支持故障/闸门注入） ----------
class FakeGateway implements KnowledgeGateway {
  failReady: boolean = false;
  listDocumentsCallCount: number = 0;
  private listGate: Promise<void> | null = null;
  private listGateRelease: () => void = (): void => {};
  private segmentsGate: Promise<void> | null = null;
  private segmentsGateRelease: () => void = (): void => {};

  constructor(private store: FakeKnowledgeStore, private bus: KnowledgeEventBus) {}

  ensureReady(): Promise<void> {
    if (this.failReady) {
      return Promise.reject(new Error('rdb open failed'));
    }
    return Promise.resolve();
  }

  holdListDocuments(): void {
    this.listGate = new Promise<void>((resolve) => { this.listGateRelease = resolve; });
  }
  releaseListDocuments(): void {
    this.listGateRelease();
  }
  holdNextGetSegments(): void {
    this.segmentsGate = new Promise<void>((resolve) => { this.segmentsGateRelease = resolve; });
  }
  releaseGetSegments(): void {
    this.segmentsGateRelease();
  }

  async listDocuments(): Promise<CourseDocument[]> {
    this.listDocumentsCallCount++;
    if (this.listGate) {
      const p = this.listGate;
      this.listGate = null;
      await p;
    }
    return this.store.listDocuments();
  }

  getDocument(id: string): Promise<CourseDocument | null> {
    return this.store.getDocument(id);
  }

  async getSegments(documentId: string, revision?: number): Promise<KnowledgeSegment[]> {
    if (this.segmentsGate) {
      const p = this.segmentsGate;
      this.segmentsGate = null;
      await p;
    }
    return this.store.getSegments(documentId, revision);
  }

  subscribeChanges(listener: KnowledgeChangeListener): () => void {
    return this.bus.subscribe(listener);
  }
}

// ---------- 索引侧适配（记录提交与结果，转发给真实 IndexSyncManager） ----------
interface Submission {
  documentId: string;
  revision: number;
  title: string;
  source: string;
  segmentCount: number;
}

class TestSinkAdapter implements IndexSyncSink {
  readonly submissions: Submission[] = [];
  readonly outcomes: IndexSyncOutcome[] = [];
  readonly deleted: string[] = [];

  constructor(private target: IndexSyncManager) {}

  handleDocumentChanged(
    documentId: string,
    revision: number,
    segments: KnowledgeSegment[],
    onComplete: (result: IndexSyncOutcome) => void,
    documentTitle: string,
    source: string
  ): void {
    this.submissions.push({ documentId, revision, title: documentTitle, source, segmentCount: segments.length });
    this.target.handleDocumentChanged(
      documentId,
      revision,
      segments,
      (r: IndexBuildResult): void => {
        this.outcomes.push({ ok: r.ok, message: r.message ?? '' });
        onComplete({ ok: r.ok, message: r.message ?? '' });
      },
      documentTitle,
      source
    );
  }

  handleDocumentDeleted(documentId: string): void {
    this.deleted.push(documentId);
    this.target.handleDocumentDeleted(documentId);
  }
}

// ---------- 闸门式 embedding（模拟在途索引任务） ----------
function fakeEmbedding(text: string, dimension: number): EmbeddingResult {
  const vec: number[] = [];
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dimension; i++) {
    vec.push(Math.sin(h + i));
  }
  return { vector: vec, model: 'gated', dimension, latencyMs: 0 };
}

class GatedEmbeddingService {
  readonly defaultModel = 'gated';
  readonly defaultDimension = 8;
  readonly available = true;
  embedBatchCallCount = 0;
  private gate: Promise<void> | null = null;
  private gateRelease: () => void = (): void => {};

  hold(): void {
    this.gate = new Promise<void>((resolve) => { this.gateRelease = resolve; });
  }

  release(): void {
    this.gateRelease();
  }

  embedText(req: EmbeddingRequest): Promise<EmbeddingResult> {
    return Promise.resolve(fakeEmbedding(req.text, this.defaultDimension));
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    this.embedBatchCallCount++;
    if (this.gate) {
      const p = this.gate;
      this.gate = null;
      await p;
    }
    return texts.map((t) => fakeEmbedding(t, this.defaultDimension));
  }
}

// ---------- 测试数据 ----------
const CONTENT_HEART_V1 =
  '心脏是胸腔内的肌性器官，旧版描述ABC。\n\n心脏的四个腔室包括左心房、右心房、左心室、右心室。\n\n冠状动脉为心肌供血。';
const CONTENT_HEART_V2 =
  '心脏是胸腔内的肌性器官，新版描述XYZ。\n\n心脏的四个腔室包括左心房、右心房、左心室、右心室。\n\n二尖瓣又称僧帽瓣，位于左房室口。';
const CONTENT_BONE =
  '骨骼系统由二百零六块骨组成。\n\n骨组织包括骨密质与骨松质。\n\n关节软骨覆盖关节面，减少摩擦。';

// ============================================================
async function main(): Promise<void> {
  // ==================== A. runInTransaction ====================
  console.log('\n[A] runInTransaction 事务编排');
  {
    const store = new FakeKnowledgeStore();
    const ok = await runInTransaction(store, async (): Promise<number> => {
      store.opLog.push('work');
      return 7;
    });
    assertEq(ok, 7, '事务成功返回结果');
    assertEq(store.txnMarkers(), ['begin', 'commit'], '成功路径 begin→commit');
  }
  {
    const store = new FakeKnowledgeStore();
    let caught = '';
    try {
      await runInTransaction(store, async (): Promise<void> => {
        throw new Error('boom');
      });
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertEq(caught, 'boom', '异常原样上抛');
    assertEq(store.txnMarkers(), ['begin', 'rollback'], '失败路径 begin→rollback，无 commit');
  }

  // ==================== B. 写协调器 + 事务一致性 ====================
  console.log('\n[B] 写协调器：原子事务 + 提交后发事件');
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);

    // B1. 新增成功：资料 + 片段同事务，事件在提交后
    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy for Students, 4th Edition", CONTENT_HEART_V1);
    assertEq(doc.revision, 1, '新增资料 revision=1');
    const segs = await store.getSegments(doc.id, 1);
    assert(segs.length >= 2, `片段随资料同事务写入（${segs.length} 个）`);
    assertEq(bus.getHistory().length, 1, '提交后发出 1 条 created 事件');
    assertEq(bus.getHistory()[0].type, 'created', '事件类型 created');
    assertEq(store.txnMarkers(), ['begin', 'commit'], '新增事务 begin→commit');

    // B2. 修改成功：revision+1，旧片段被替换
    const updated = await writer.updateDocument(doc.id, '心脏解剖讲义·修订', 'Gray\'s Anatomy, 4e', CONTENT_HEART_V2);
    assertEq(updated?.revision, 2, '修改后 revision=2');
    const segs2 = await store.getSegments(doc.id);
    assert(segs2.every((s) => s.documentRevision === 2), '库中片段全部为 revision 2');
    assert(segs2.every((s) => !s.id.includes('-r1-')), '旧版本片段 ID 已不存在');
    const hist2 = bus.getHistory();
    assertEq(hist2.length, 2, '累计 2 条事件');
    assertEq(hist2[1].previousRevision, 1, 'updated 事件携带 previousRevision=1');

    // B3. 删除成功：资料 + 片段级联删除
    const ok = await writer.deleteDocument(doc.id);
    assert(ok, '删除返回 true');
    assertEq(await store.getDocument(doc.id), null, '资料已删除');
    assertEq((await store.getSegments(doc.id)).length, 0, '片段已级联删除');
    const hist3 = bus.getHistory();
    assertEq(hist3[2].type, 'deleted', 'deleted 事件已发出');
    assertEq(hist3[2].segments.length, 0, 'deleted 事件片段为空');
  }

  // B4. 更新中途写入失败：全部回滚，不发事件
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);
    const beforeSegs = await store.getSegments(doc.id, 1);

    store.failNextTransactionAtSegment(2); // 第 2 个片段插入时失败
    let caught = '';
    try {
      await writer.updateDocument(doc.id, '不应落库', '不应落库', CONTENT_HEART_V2);
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertEq(caught, 'injected segment write failure', '更新中途失败异常上抛');
    const after = await store.getDocument(doc.id);
    assertEq(after?.revision, 1, '回滚后 revision 仍为 1');
    assertEq(after?.title, '心脏解剖讲义', '回滚后标题未被污染');
    const afterSegs = await store.getSegments(doc.id);
    assertEq(afterSegs.map((s) => s.id), beforeSegs.map((s) => s.id), '回滚后旧片段完整保留');
    assertEq(bus.getHistory().length, 1, '回滚后没有发出 updated 事件（只有 created）');
    assertEq(store.txnMarkers(), ['begin', 'commit', 'begin', 'rollback'], '失败事务已 rollback');

    // 互斥锁在失败后释放：后续写操作可正常进行
    const again = await writer.updateDocument(doc.id, '恢复写入', 'Gray\'s Anatomy', CONTENT_HEART_V2);
    assertEq(again?.revision, 2, '失败后互斥锁已释放，后续更新成功');
  }

  // B5. 新增失败同样回滚
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    store.failNextTransactionAtSegment(1);
    let caught = '';
    try {
      await writer.createDocument('x', 'y', CONTENT_HEART_V1);
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    assertEq(caught, 'injected segment write failure', '新增注入失败上抛');
    assertEq((await store.listDocuments()).length, 0, '新增回滚后无残留资料');
    assertEq(store.allSegments().length, 0, '新增回滚后无残留片段');
    assertEq(bus.getHistory().length, 0, '新增失败未发出任何事件');
  }

  // B6. 并发写串行化：事务标记严格交替，不交错
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    await Promise.all([
      writer.createDocument('资料甲', '来源甲', CONTENT_HEART_V1),
      writer.createDocument('资料乙', '来源乙', CONTENT_BONE),
      writer.createDocument('资料丙', '来源丙', CONTENT_HEART_V2)
    ]);
    assertEq((await store.listDocuments()).length, 3, '并发 3 个新增全部成功');
    const markers = store.txnMarkers();
    assertEq(markers, ['begin', 'commit', 'begin', 'commit', 'begin', 'commit'], '并发事务严格串行（无交错）');
    assertEq(bus.getHistory().length, 3, '三个 created 事件均发出');
  }

  // ==================== C. 索引一致性（真实 D 侧类） ====================
  console.log('\n[C] 索引一致性（真实 IndexSyncManager/MemoryVectorStore/HybridRetrievalService）');

  // C1. 启动全量同步 + 元信息完整（标题/来源/版本/位置）
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const docA = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy for Students, 4th Edition", CONTENT_HEART_V1);
    const docB = await writer.createDocument('骨骼系统概论', "Netter's Atlas of Human Anatomy, 7th Edition", CONTENT_BONE);

    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);

    await core.start();
    await flush();
    assert(core.isReady(), '全量同步后状态 ready');
    assertEq(manager.pendingCount, 0, '无残留索引任务');
    const totalSegs = store.allSegments().length;
    assertEq(retrieval.indexedCount, totalSegs, '检索侧片段数 = 库中片段数');
    assertEq(vectorStore.size(), totalSegs, '向量数 = 库中片段数');
    const allVecs = vectorStore.search([], 100, -1);
    assert(allVecs.every((v) => v.documentRevision === 1), '向量版本全部为 revision 1');
    assertEq(sink.submissions.length, 2, '全量同步提交 2 份资料');
    assertEq(sink.submissions[0].title.length > 0, true, '提交携带资料标题');

    const chunks = await retrieval.retrieve('心脏的四个腔室', 5);
    const heartChunks = chunks.filter((c) => c.documentId === docA.id);
    assert(heartChunks.length > 0, '检索命中目标资料');
    assertEq(heartChunks[0].documentTitle, '心脏解剖讲义', '检索结果保留资料标题');
    assertEq(heartChunks[0].source, "Gray's Anatomy for Students, 4th Edition", '检索结果保留资料来源');
    const segOfChunk = await store.getSegments(docA.id, 1);
    const hit = segOfChunk.find((s) => s.id === heartChunks[0].segmentId);
    assert(hit !== undefined && hit.content === heartChunks[0].text, '检索片段与库中片段一致（位置可定位）');
    core.stop();
  }

  // C2. 修改后旧版本退出检索；元信息同步更新
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);
    await core.start();

    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);
    await flush();
    const rev1SegIds = (await store.getSegments(doc.id, 1)).map((s) => s.id);
    assert(rev1SegIds.length > 0, 'rev1 片段已入库');
    assert(vectorStore.search([], 100, -1).some((v) => rev1SegIds.includes(v.segmentId)), 'rev1 向量已建立');

    await writer.updateDocument(doc.id, '心脏解剖讲义·第二版', 'Gray\'s Anatomy, 4e, 修订', CONTENT_HEART_V2);
    await flush();
    assertEq(manager.pendingCount, 0, '更新索引任务已完成');
    const vecs = vectorStore.search([], 100, -1).filter((v) => v.documentId === doc.id);
    assert(vecs.length > 0, 'rev2 向量已建立');
    assert(vecs.every((v) => v.documentRevision === 2), '该资料向量全部为 revision 2');
    assert(vecs.every((v) => !rev1SegIds.includes(v.segmentId)), 'rev1 旧片段向量已全部退出');

    const oldChunks = await retrieval.retrieve('旧版描述ABC', 5);
    assert(oldChunks.every((c) => !c.text.includes('旧版描述ABC')), '旧版本内容退出检索');
    const newChunks = await retrieval.retrieve('新版描述XYZ', 5);
    assert(newChunks.some((c) => c.text.includes('新版描述XYZ')), '新版本内容进入检索');
    assertEq(newChunks[0].documentTitle, '心脏解剖讲义·第二版', '检索元信息标题同步为新版本');
    assertEq(newChunks[0].source, 'Gray\'s Anatomy, 4e, 修订', '检索元信息来源同步为新版本');
    core.stop();
  }

  // C3. 删除后旧片段退出检索
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);
    await core.start();

    const docA = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);
    await writer.createDocument('骨骼系统概论', "Netter's Atlas", CONTENT_BONE);
    await flush();
    const beforeCount = retrieval.indexedCount;

    await writer.deleteDocument(docA.id);
    await flush();
    assertEq(sink.deleted, [docA.id], 'deleted 事件转发索引删除');
    assertEq(vectorStore.search([], 100, -1).filter((v) => v.documentId === docA.id).length, 0, '已删资料向量清零');
    const chunks = await retrieval.retrieve('心脏 骨骼 关节', 10);
    assert(chunks.every((c) => c.documentId !== docA.id), '检索结果不再包含已删资料');
    assert(retrieval.indexedCount < beforeCount, '检索侧片段数已下降');
    core.stop();
  }

  // C4. 删除时在途索引任务不得恢复该资料
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const emb = new GatedEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb as unknown as TestEmbeddingService, vectorStore);
    const manager = new IndexSyncManager(emb as unknown as TestEmbeddingService, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);
    await core.start();

    emb.hold(); // embedding 挂起，模拟在途任务
    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);
    // 等待事件转发进入 embedBatch（任务在途）
    for (let i = 0; i < 20 && emb.embedBatchCallCount === 0; i++) {
      await delay(2);
    }
    assertEq(emb.embedBatchCallCount, 1, '索引任务已进入 embedding（在途）');
    assertEq(manager.pendingCount, 1, '在途任务计数为 1');

    await writer.deleteDocument(doc.id); // 删除发生在 embedding 在途期间
    assertEq(sink.deleted, [doc.id], '删除事件已转发');
    emb.release();
    await flush();

    assertEq(manager.pendingCount, 0, '在途任务已收尾');
    assertEq(vectorStore.search([], 100, -1).filter((v) => v.documentId === doc.id).length, 0, '在途任务未能恢复已删资料向量');
    assertEq(retrieval.indexedCount, 0, '检索侧无该资料片段残留');
    const lastOutcome = sink.outcomes[sink.outcomes.length - 1];
    assert(!lastOutcome.ok && lastOutcome.message.includes('superseded'), '在途任务被判定为 superseded 并丢弃');
    core.stop();
  }

  // C5. 竞态：全量同步 listDocuments 期间发生修改 → 索引为新版本，且不重复提交
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1); // 启动前已存在 rev1

    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);

    gateway.holdListDocuments(); // 全量同步卡在列表读取
    const startPromise = core.start();
    await delay(4); // 确保订阅已生效、listDocuments 在闸门处挂起

    await writer.updateDocument(doc.id, '心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V2); // rev2 事件经订阅路径提交
    await flush();
    gateway.releaseListDocuments(); // 全量同步继续
    await startPromise;
    await flush();

    assert(core.isReady(), '竞态场景同步完成');
    const docSubmissions = sink.submissions.filter((s) => s.documentId === doc.id);
    assertEq(docSubmissions.length, 1, '该资料只提交一次（无陈旧重复提交）');
    assertEq(docSubmissions[0].revision, 2, '提交的是最新 revision 2');
    const vecs = vectorStore.search([], 100, -1).filter((v) => v.documentId === doc.id);
    assert(vecs.length > 0 && vecs.every((v) => v.documentRevision === 2), '索引中仅有 revision 2 向量');
    const chunks = await retrieval.retrieve('新版描述XYZ', 5);
    assert(chunks.some((c) => c.text.includes('新版描述XYZ')), '竞态后检索到新版本内容');
    core.stop();
  }

  // C6. 竞态：全量同步读取片段期间发生修改 → 陈旧空片段不得覆盖新版本
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    const doc = await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);

    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const sink = new TestSinkAdapter(manager);
    const gateway = new FakeGateway(store, bus);
    const core = new KnowledgeSyncCore(gateway, sink);

    gateway.holdNextGetSegments(); // 卡在「全量同步读取片段」
    const startPromise = core.start();
    for (let i = 0; i < 20 && gateway.listDocumentsCallCount === 0; i++) {
      await delay(2);
    }
    await delay(4); // listDocuments 完成，getSegments 挂起

    await writer.updateDocument(doc.id, '心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V2); // rev2 经事件路径提交
    await flush();
    gateway.releaseGetSegments(); // 返回 rev1 片段（已被删除 → 空数组）
    await startPromise;
    await flush();

    const docSubmissions = sink.submissions.filter((s) => s.documentId === doc.id);
    assertEq(docSubmissions.length, 1, '陈旧快照未二次提交');
    assertEq(docSubmissions[0].revision, 2, '唯一提交为 revision 2');
    const vecs = vectorStore.search([], 100, -1).filter((v) => v.documentId === doc.id);
    assert(vecs.length > 0 && vecs.every((v) => v.documentRevision === 2), 'rev2 向量未被陈旧空片段清空');
    assert(retrieval.indexedCount > 0, '检索侧保留 rev2 片段');
    core.stop();
  }

  // ==================== D. 状态机 / 重试 / 幂等 ====================
  console.log('\n[D] 同步桥状态机');
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);
    await writer.createDocument('骨骼系统概论', "Netter's Atlas", CONTENT_BONE);

    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const gateway = new FakeGateway(store, bus);
    const sink = new TestSinkAdapter(manager);
    const core = new KnowledgeSyncCore(gateway, sink);

    const states: string[] = [];
    core.onStatus((s: KnowledgeSyncStatus): void => {
      states.push(s.state);
    });
    assertEq(states, ['idle'], 'onStatus 立即回调当前状态 idle');

    await core.start();
    assertEq(states[states.length - 1], 'ready', 'start 后状态 ready');
    assert(states.includes('syncing'), '状态经过 syncing');
    const status = core.getStatus();
    assertEq(status.totalDocuments, 2, '全量同步发现 2 份资料');
    assertEq(status.syncedDocuments, 2, '2 份资料均已处理');

    // 幂等：并发 start 共享同一 promise，全量只执行一次
    const beforeCalls = gateway.listDocumentsCallCount;
    await Promise.all([core.start(), core.start()]);
    assertEq(gateway.listDocumentsCallCount, beforeCalls, 'ready 后重复 start 不再全量同步');

    // stop 后退订：新增资料不再触发索引提交
    core.stop();
    assertEq(core.getStatus().state, 'idle', 'stop 后回到 idle');
    const submissionsAfterStop = sink.submissions.length;
    await writer.createDocument('内分泌讲义', 'Guyton and Hall', CONTENT_BONE);
    await flush();
    assertEq(sink.submissions.length, submissionsAfterStop, 'stop 后新增资料不再进入索引');
  }

  // D2. 初始化失败 → error → retry 恢复
  {
    const store = new FakeKnowledgeStore();
    const bus = new KnowledgeEventBus();
    const writer = new KnowledgeWriteCoordinator(store, new SegmentService(), bus);
    await writer.createDocument('心脏解剖讲义', "Gray's Anatomy", CONTENT_HEART_V1);

    const emb = new TestEmbeddingService();
    const vectorStore = new MemoryVectorStore();
    const retrieval = new HybridRetrievalService(emb, vectorStore);
    const manager = new IndexSyncManager(emb, vectorStore, retrieval);
    const gateway = new FakeGateway(store, bus);
    gateway.failReady = true;
    const core = new KnowledgeSyncCore(gateway, new TestSinkAdapter(manager));

    await core.start(); // 失败不抛异常
    let status = core.getStatus();
    assertEq(status.state, 'error', '初始化失败状态为 error');
    assert(status.lastError.includes('rdb open failed'), 'lastError 记录失败原因');

    gateway.failReady = false;
    await core.retry();
    status = core.getStatus();
    assertEq(status.state, 'ready', 'retry 后恢复 ready');
    assertEq(status.syncedDocuments, 1, 'retry 后全量同步完成');
    await flush();
    assert(retrieval.indexedCount > 0, 'retry 后索引可用');
    core.stop();
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();
