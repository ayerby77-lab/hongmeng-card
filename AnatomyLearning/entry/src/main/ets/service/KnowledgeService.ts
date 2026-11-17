import { common } from '@kit.AbilityKit';
import { CourseDocument, KnowledgeSegment, DocumentChangeEvent, CitationResolveResult } from '../model/Knowledge';
import { KnowledgeStore } from '../store/KnowledgeStore';
import { SegmentService } from './SegmentService';
import { KnowledgeEventBus, KnowledgeChangeListener } from './KnowledgeEventBus';
import { KnowledgeGateway, KnowledgeWriteCoordinator } from './KnowledgeSyncCore';

/**
 * 资料服务：整合存储、切分和事件通知。
 * 页面和检索模块均通过此服务操作资料。
 *
 * 一致性保证：
 *   - create/update/delete 委托给 KnowledgeWriteCoordinator：
 *     资料行与片段行在同一 RDB 事务中落库，任一步失败整体回滚；
 *     只有事务提交成功后才发布 DocumentChangeEvent，检索模块不会收到脏事件；
 *     所有写操作经互斥锁串行化，避免并发事务交错。
 *   - 读路径（list/get/getSegments/resolveCitation）直接走 KnowledgeStore。
 */
export class KnowledgeService implements KnowledgeGateway {
  private store: KnowledgeStore;
  private segmentService: SegmentService;
  private eventBus: KnowledgeEventBus;
  private writer: KnowledgeWriteCoordinator;
  private static instance: KnowledgeService | null = null;

  constructor(context: common.Context) {
    this.store = new KnowledgeStore(context);
    this.segmentService = new SegmentService();
    this.eventBus = new KnowledgeEventBus();
    this.writer = new KnowledgeWriteCoordinator(this.store, this.segmentService, this.eventBus);
  }

  static getInstance(context: common.Context): KnowledgeService {
    if (!KnowledgeService.instance) {
      KnowledgeService.instance = new KnowledgeService(context);
    }
    return KnowledgeService.instance;
  }

  async ensureReady(): Promise<void> {
    await this.store.ensureReady();
  }

  // ===== 事件订阅（供检索模块） =====

  subscribeChanges(listener: KnowledgeChangeListener): () => void {
    return this.eventBus.subscribe(listener);
  }

  getChangeHistory(): DocumentChangeEvent[] {
    return this.eventBus.getHistory();
  }

  // ===== 资料 CRUD（写路径走协调器，事务原子 + 提交后发事件） =====

  async listDocuments(): Promise<CourseDocument[]> {
    await this.ensureReady();
    return this.store.listDocuments();
  }

  async getDocument(id: string): Promise<CourseDocument | null> {
    await this.ensureReady();
    return this.store.getDocument(id);
  }

  /**
   * 新增资料。
   * 自动切分正文，资料行与片段在同一事务中落库；提交成功后发出 created 事件。
   */
  async createDocument(title: string, source: string, content: string): Promise<CourseDocument> {
    await this.ensureReady();
    return this.writer.createDocument(title, source, content);
  }

  /**
   * 修改资料。
   * 版本号自增、重新切分，版本更新与片段替换在同一事务中完成；提交成功后发出 updated 事件。
   */
  async updateDocument(id: string, title: string, source: string, content: string): Promise<CourseDocument | null> {
    await this.ensureReady();
    return this.writer.updateDocument(id, title, source, content);
  }

  /**
   * 删除资料及其全部片段（同事务级联删除）；提交成功后发出 deleted 事件。
   */
  async deleteDocument(id: string): Promise<boolean> {
    await this.ensureReady();
    return this.writer.deleteDocument(id);
  }

  // ===== 片段查询（供检索模块和引用跳转） =====

  /**
   * 获取资料片段。
   * 指定 revision 时返回该版本片段；否则返回当前版本片段。
   */
  async getSegments(documentId: string, revision?: number): Promise<KnowledgeSegment[]> {
    await this.ensureReady();
    if (revision !== undefined) {
      return this.store.getSegments(documentId, revision);
    }
    const doc = await this.store.getDocument(documentId);
    if (!doc) {
      return [];
    }
    return this.store.getSegments(documentId, doc.revision);
  }

  /** 获取指定片段 */
  async getSegment(segmentId: string): Promise<KnowledgeSegment | null> {
    await this.ensureReady();
    return this.store.getSegment(segmentId);
  }

  /**
   * 获取当前所有有效片段（供检索模块全量建索引）。
   * 只返回与资料当前版本一致的片段。
   */
  async getAllActiveSegments(): Promise<KnowledgeSegment[]> {
    await this.ensureReady();
    return this.store.getAllActiveSegments();
  }

  /**
   * 解析引用，判断引用是否过期。
   * 旧引用遇到资料变化时给出明确提示。
   */
  async resolveCitation(documentId: string, documentRevision: number, segmentId: string): Promise<CitationResolveResult> {
    await this.ensureReady();
    const doc = await this.store.getDocument(documentId);
    if (!doc) {
      return {
        found: false,
        revisionCurrent: false,
        staleReason: '该资料已被删除，引用无法查看原文。'
      };
    }
    if (doc.revision !== documentRevision) {
      // 版本不一致，尝试查找片段但标记为过期
      const seg = await this.store.getSegment(segmentId);
      if (seg) {
        return {
          found: true,
          revisionCurrent: false,
          segment: seg,
          document: doc,
          staleReason: `该资料已更新（当前版本 ${doc.revision}，引用版本 ${documentRevision}），以下内容可能已变更。`
        };
      }
      return {
        found: false,
        revisionCurrent: false,
        document: doc,
        staleReason: `该资料已更新（当前版本 ${doc.revision}，引用版本 ${documentRevision}），原引用片段已不存在。`
      };
    }
    const seg = await this.store.getSegment(segmentId);
    if (!seg) {
      return {
        found: false,
        revisionCurrent: true,
        document: doc,
        staleReason: '引用片段不存在。'
      };
    }
    return {
      found: true,
      revisionCurrent: true,
      segment: seg,
      document: doc
    };
  }

  /** 获取片段在原文中的上下文 */
  getSegmentContext(doc: CourseDocument, segment: KnowledgeSegment, extend: number = 50): string {
    return this.segmentService.getContext(doc.content, segment, extend);
  }
}
