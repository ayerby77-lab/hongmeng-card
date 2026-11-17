import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { CourseDocument, KnowledgeSegment } from '../model/Knowledge';
import { KnowledgeWriteStore, runInTransaction } from '../service/KnowledgeSyncCore';

const DB_NAME = 'anatomy_knowledge.db';
const DB_VERSION = 1;
const TAG = 'KnowledgeStore';

const SQL_CREATE_DOCUMENTS = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const SQL_CREATE_SEGMENTS = `
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  document_revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  seq_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_document ON segments(document_id, document_revision);
`;

/**
 * 课程资料 RDB 存储。
 * 负责 documents / segments 两张表的持久化，不包含切分逻辑。
 *
 * 事务约定：
 *   - 资料与片段的跨表写入/删除必须走 createDocumentWithSegments /
 *     updateDocumentWithSegments / deleteDocumentCascade 三个原子方法，
 *     任一步失败整体回滚，不留「revision 已增但片段仍是旧版」的半成品。
 *   - 原子方法内部自带事务（runInTransaction），调用方不得嵌套事务；
 *     并发写由 KnowledgeWriteCoordinator 的互斥锁串行化。
 */
export class KnowledgeStore implements KnowledgeWriteStore {
  private store: relationalStore.RdbStore | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private context: common.Context) {
  }

  async ensureReady(): Promise<void> {
    if (this.store) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.open();
    return this.initPromise;
  }

  private async open(): Promise<void> {
    const config: relationalStore.StoreConfig = {
      name: DB_NAME,
      securityLevel: relationalStore.SecurityLevel.S1
    };
    this.store = await relationalStore.getRdbStore(this.context, config);
    if (this.store.version !== DB_VERSION) {
      this.store.version = DB_VERSION;
    }
    await this.store.executeSql(SQL_CREATE_DOCUMENTS);
    await this.store.executeSql(SQL_CREATE_SEGMENTS);
    hilog.info(0x0000, TAG, 'Database opened: %{public}s', DB_NAME);
  }

  private getStore(): relationalStore.RdbStore {
    if (!this.store) {
      throw new Error('KnowledgeStore not initialized. Call ensureReady() first.');
    }
    return this.store;
  }

  // ===== 事务原语 =====
  // RdbStore 的 beginTransaction/commit/rollBack 为同步调用，这里以 async 对齐接口约定。
  // 事务是连接级的：同一 RdbStore 上的写操作在 commit/rollBack 前都属于当前事务。

  async beginTransaction(): Promise<void> {
    this.getStore().beginTransaction();
  }

  async commit(): Promise<void> {
    this.getStore().commit();
  }

  async rollBack(): Promise<void> {
    this.getStore().rollBack();
  }

  // ===== 原子复合写（资料 + 片段 同事务） =====

  /** 单事务：插入资料 + 写入全部片段。任一步失败整体回滚。 */
  async createDocumentWithSegments(doc: CourseDocument, segments: KnowledgeSegment[]): Promise<void> {
    await runInTransaction(this, async (): Promise<void> => {
      await this.insertDocument(doc);
      await this.insertSegments(segments);
    });
  }

  /** 单事务：更新资料（revision 由调用方自增）+ 删除旧片段 + 写入新片段。 */
  async updateDocumentWithSegments(doc: CourseDocument, segments: KnowledgeSegment[]): Promise<void> {
    await runInTransaction(this, async (): Promise<void> => {
      await this.updateDocument(doc);
      await this.deleteSegmentsByDocument(doc.id);
      await this.insertSegments(segments);
    });
  }

  /** 单事务：删除资料 + 级联删除全部片段。 */
  async deleteDocumentCascade(id: string): Promise<void> {
    await runInTransaction(this, async (): Promise<void> => {
      const predicates = new relationalStore.RdbPredicates('documents');
      predicates.equalTo('id', id);
      await this.getStore().delete(predicates);
      await this.deleteSegmentsByDocument(id);
    });
  }

  // ===== documents =====

  async listDocuments(): Promise<CourseDocument[]> {
    const store = this.getStore();
    const resultSet = await store.querySql(
      'SELECT id, title, source, content, revision, created_at, updated_at FROM documents ORDER BY updated_at DESC'
    );
    const docs: CourseDocument[] = [];
    while (resultSet.goToNextRow()) {
      docs.push(this.rowToDocument(resultSet));
    }
    resultSet.close();
    return docs;
  }

  async getDocument(id: string): Promise<CourseDocument | null> {
    const store = this.getStore();
    const resultSet = await store.querySql(
      'SELECT id, title, source, content, revision, created_at, updated_at FROM documents WHERE id = ?',
      [id]
    );
    let doc: CourseDocument | null = null;
    if (resultSet.goToFirstRow()) {
      doc = this.rowToDocument(resultSet);
    }
    resultSet.close();
    return doc;
  }

  async insertDocument(doc: CourseDocument): Promise<void> {
    const store = this.getStore();
    const values = {
      id: doc.id,
      title: doc.title,
      source: doc.source,
      content: doc.content,
      revision: doc.revision,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt
    };
    await store.insert('documents', values);
  }

  async updateDocument(doc: CourseDocument): Promise<void> {
    const store = this.getStore();
    const values = {
      title: doc.title,
      source: doc.source,
      content: doc.content,
      revision: doc.revision,
      updated_at: doc.updatedAt
    };
    const predicates = new relationalStore.RdbPredicates('documents');
    predicates.equalTo('id', doc.id);
    await store.update(values, predicates);
  }

  /** 删除资料及其全部片段。委托给 deleteDocumentCascade，保证同事务原子性。 */
  async deleteDocument(id: string): Promise<void> {
    await this.deleteDocumentCascade(id);
  }

  private rowToDocument(rs: relationalStore.ResultSet): CourseDocument {
    return {
      id: rs.getString(rs.getColumnIndex('id')),
      title: rs.getString(rs.getColumnIndex('title')),
      source: rs.getString(rs.getColumnIndex('source')),
      content: rs.getString(rs.getColumnIndex('content')),
      revision: rs.getLong(rs.getColumnIndex('revision')),
      createdAt: rs.getLong(rs.getColumnIndex('created_at')),
      updatedAt: rs.getLong(rs.getColumnIndex('updated_at'))
    };
  }

  // ===== segments =====

  async replaceSegments(documentId: string, documentRevision: number, segments: KnowledgeSegment[]): Promise<void> {
    // 先删除该资料的旧片段，再插入新版本片段。
    // 注意：本方法不自带事务；需要原子性时请使用 updateDocumentWithSegments。
    await this.deleteSegmentsByDocument(documentId);
    await this.insertSegments(segments);
  }

  private async insertSegments(segments: KnowledgeSegment[]): Promise<void> {
    const store = this.getStore();
    for (const seg of segments) {
      const values = {
        id: seg.id,
        document_id: seg.documentId,
        document_revision: seg.documentRevision,
        content: seg.content,
        start_offset: seg.startOffset,
        end_offset: seg.endOffset,
        seq_index: seg.seqIndex
      };
      await store.insert('segments', values);
    }
  }

  async getSegments(documentId: string, documentRevision?: number): Promise<KnowledgeSegment[]> {
    const store = this.getStore();
    let sql = 'SELECT id, document_id, document_revision, content, start_offset, end_offset, seq_index FROM segments WHERE document_id = ?';
    const params: Array<string | number> = [documentId];
    if (documentRevision !== undefined) {
      sql += ' AND document_revision = ?';
      params.push(documentRevision);
    }
    sql += ' ORDER BY seq_index ASC';
    const resultSet = await store.querySql(sql, params);
    const segs: KnowledgeSegment[] = [];
    while (resultSet.goToNextRow()) {
      segs.push(this.rowToSegment(resultSet));
    }
    resultSet.close();
    return segs;
  }

  async getSegment(id: string): Promise<KnowledgeSegment | null> {
    const store = this.getStore();
    const resultSet = await store.querySql(
      'SELECT id, document_id, document_revision, content, start_offset, end_offset, seq_index FROM segments WHERE id = ?',
      [id]
    );
    let seg: KnowledgeSegment | null = null;
    if (resultSet.goToFirstRow()) {
      seg = this.rowToSegment(resultSet);
    }
    resultSet.close();
    return seg;
  }

  /** 获取当前所有有效片段（供检索模块建立索引） */
  async getAllActiveSegments(): Promise<KnowledgeSegment[]> {
    const store = this.getStore();
    // 只返回与资料当前版本一致的片段
    const sql = `
      SELECT s.id, s.document_id, s.document_revision, s.content, s.start_offset, s.end_offset, s.seq_index
      FROM segments s
      INNER JOIN documents d ON s.document_id = d.id AND s.document_revision = d.revision
      ORDER BY s.document_id, s.seq_index
    `;
    const resultSet = await store.querySql(sql);
    const segs: KnowledgeSegment[] = [];
    while (resultSet.goToNextRow()) {
      segs.push(this.rowToSegment(resultSet));
    }
    resultSet.close();
    return segs;
  }

  private async deleteSegmentsByDocument(documentId: string): Promise<void> {
    const store = this.getStore();
    const predicates = new relationalStore.RdbPredicates('segments');
    predicates.equalTo('document_id', documentId);
    await store.delete(predicates);
  }

  private rowToSegment(rs: relationalStore.ResultSet): KnowledgeSegment {
    return {
      id: rs.getString(rs.getColumnIndex('id')),
      documentId: rs.getString(rs.getColumnIndex('document_id')),
      documentRevision: rs.getLong(rs.getColumnIndex('document_revision')),
      content: rs.getString(rs.getColumnIndex('content')),
      startOffset: rs.getLong(rs.getColumnIndex('start_offset')),
      endOffset: rs.getLong(rs.getColumnIndex('end_offset')),
      seqIndex: rs.getLong(rs.getColumnIndex('seq_index'))
    };
  }
}
