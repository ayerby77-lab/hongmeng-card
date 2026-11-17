// 课程知识问答页（Agent E）。
//
// 完整用户流程：
//   初始化 → 资料处理中 → 检索中 → 输出中 → 完成 / 断网 / 无结果 / 失败
//   手动提问与 ArkAF 意图自动提问共用同一个提交入口 submitQuestion()。
//   引用点击 → pushUrl({ url:'pages/SourceDetail', params:{documentId, segmentId, documentRevision} })。
//   请求编号 requestSeq 覆盖「检索 + 生成」全过程：取消 / 重试 / 离页后旧回调一律失效。

import { common } from '@kit.AbilityKit';
import { connection } from '@kit.NetworkKit';
import { ChatMessage, QueryState, RetrievedChunk, SourceCitation } from '../model/Knowledge';
import { ChatHandle, ChatTurn, StreamEventImpl, ServiceError, ServiceException } from '../service/types';
import { KnowledgeRuntime, IndexStatus, PageLease } from '../app/KnowledgeRuntime';
import { ArkAFIntent, ConsumedResult } from '../model/ArkAFIntent';
import { seedDemoDocuments } from '../service/seed/DemoDocuments';

/** SourceDetail 路由参数（目标契约 SourceParams：documentId + documentRevision + segmentId）。 */
interface SourceRouteParams {
  documentId: string;
  segmentId: string;
  documentRevision: number;
}

@Entry
@Component
struct KnowledgeQA {
  @State private messages: ChatMessage[] = [];
  @State private inputText: string = '';
  @State private queryState: QueryState = 'idle';
  @State private statusText: string = '';
  @State private indexText: string = '正在初始化…';
  @State private showDemoEntry: boolean = false;

  // ---- ArkAF 热启动通知 ----
  // 完整请求 JSON 变化时通知当前可见页面；冷启动在 aboutToAppear 主动读取。
  @StorageProp(ArkAFIntent.PENDING_QUESTION_KEY)
  @Watch('onPendingStorageChange')
  private pendingFromStorage: string = '';

  private runtime: KnowledgeRuntime | null = null;
  private lease: PageLease | null = null;
  private unsubIndex: (() => void) | null = null;
  private currentCancel: ChatHandle | null = null;

  /** 请求编号：每次提交 / 取消 / 离页 +1，旧编号的所有回调都被丢弃。 */
  private requestSeq: number = 0;
  /** 当前正在流式写入的 assistant 消息下标；-1 表示无。 */
  private streamIndex: number = -1;
  /** 已经处理过的意图 requestId，相同 id 不再提交（去重）。 */
  private lastProcessedRequestId: string = '';

  /** 本次请求检索命中的片段 ID（引用必须来自同一次请求）。 */
  private allowedSegmentIds: string[] = [];
  /** 片段 → 权威版本号（由资料库读出）。 */
  private revisionBySegment: Map<string, number> = new Map();
  /** 资料 → 当前版本号（片段已失效时的兜底）。 */
  private revisionByDocument: Map<string, number> = new Map();

  private cloudMode: boolean = false;
  private pendingQuestion: string = '';
  private pendingAutoSubmit: boolean = false;
  private pendingRequestId: string = '';
  private pageVisible: boolean = false;

  private scroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.pageVisible = true;
    // 冷启动：EntryAbility.onWindowStageCreate 直接 loadContent('pages/KnowledgeQA')，
    // 这里主动读取请求；服务就绪受理后才确认清除。
    const intent = ArkAFIntent.consumePendingQuestion();
    if (intent !== undefined && intent.question.length > 0) {
      this.acceptIntent(intent);
    }
    // 若 EntryAbility 没走（直接 pushUrl），兜底看一眼 Storage
    this.onPendingStorageChange();
    void this.bootstrapRuntime();
  }

  /**
   * @Watch 回调：AppStorage 的 pendingQuestion 变化（热启动 / QAIntentExecutor 路径）。
   * 仅可见页面受理，初始化失败时保留请求供再次进入重试。
   */
  private onPendingStorageChange(): void {
    if (!this.pageVisible || this.pendingFromStorage.length === 0) {
      return; // 已被消费或尚未发布
    }
    const intent = ArkAFIntent.consumePendingQuestion();
    if (intent !== undefined && intent.question.length > 0) {
      this.acceptIntent(intent);
    }
  }

  /**
   * 统一接收意图请求：做 requestId 去重 → 正在回答则 cancel 旧请求 → 填入 pending → 若初始化已就绪则自动提交。
   */
  private acceptIntent(intent: ConsumedResult): void {
    // 同 requestId 只提交一次；用户以新 requestId 提相同问题是允许的。
    if (intent.requestId.length > 0 && intent.requestId === this.lastProcessedRequestId) {
      return;
    }
    this.lastProcessedRequestId = intent.requestId;

    // 正在回答时收到新意图：取消旧请求（cancel 会让 requestSeq +1 且 ChatHandle.cancel），
    // 然后正常走 pending → 提交流程。
    if (this.isBusy() || this.isQuerying()) {
      this.cancelInFlight();
      this.queryState = 'idle';
      this.statusText = '已取消上一个请求，正在处理新问题…';
    }

    this.pendingQuestion = intent.question;
    this.pendingAutoSubmit = intent.autoSubmit;
    this.pendingRequestId = intent.requestId;
    this.submitPendingIntent();
  }

  onPageShow(): void {
    this.pageVisible = true;
    this.onPendingStorageChange();
    this.submitPendingIntent();
  }

  onPageHide(): void {
    this.pageVisible = false;
    // 页面被遮挡（跳转原文 / 切后台）：在途请求立即取消。
    if (this.isBusy()) {
      this.cancelInFlight();
      this.queryState = 'idle';
      this.statusText = '已离开页面，请求已取消';
    }
  }

  aboutToDisappear(): void {
    this.pageVisible = false;
    // 释放请求 + 订阅 + 页面租约（不停 bridge，保持索引热度）。
    this.cancelInFlight();
    if (this.unsubIndex !== null) {
      this.unsubIndex();
      this.unsubIndex = null;
    }
    if (this.lease !== null) {
      this.lease.release();
      this.lease = null;
    }
    this.streamIndex = -1;
  }

  // ------------------------------------------------------------------
  // 初始化
  // ------------------------------------------------------------------
  private async bootstrapRuntime(): Promise<void> {
    this.queryState = 'loading';
    this.statusText = '正在初始化课程资料库…';
    const context = getContext(this) as common.UIAbilityContext;
    let rt: KnowledgeRuntime;
    try {
      rt = await KnowledgeRuntime.init(context);
    } catch (e) {
      this.queryState = 'error';
      this.statusText = '课程资料库初始化失败，请返回后重试。';
      this.indexText = '初始化失败';
      // 初始化失败时保留 pendingRequestId（下次进入会触发重试）。
      return;
    }
    this.runtime = rt;
    this.cloudMode = rt.useCloud;
    this.lease = rt.acquirePage();
    this.unsubIndex = rt.onIndexStatus((s: IndexStatus): void => {
      this.onIndexStatus(s);
    });
    this.onIndexStatus(rt.indexStatus());
    if (this.queryState === 'loading') {
      this.queryState = 'idle';
      this.statusText = '';
    }

    this.submitPendingIntent();
  }

  private submitPendingIntent(): void {
    if (!this.pageVisible || this.runtime === null || this.pendingQuestion.length === 0) return;
    const index = this.runtime.indexStatus();
    if (!index.ready || index.pendingCount > 0) return;
    const q = this.pendingQuestion;
    const id = this.pendingRequestId;
    const auto = this.pendingAutoSubmit;
    this.pendingQuestion = '';
    this.pendingAutoSubmit = false;
    this.pendingRequestId = '';
    this.inputText = q;
    this.queryState = 'idle';
    ArkAFIntent.acknowledge(id);
    if (auto) this.submitQuestion(q);
  }

  private onIndexStatus(s: IndexStatus): void {
    if (s.pendingCount > 0) {
      this.indexText = '资料处理中：' + s.pendingCount + ' 个索引任务';
    } else if (s.ready) {
      this.indexText = '索引就绪：已收录 ' + s.indexedCount + ' 个片段';
    } else {
      this.indexText = '索引尚未就绪';
    }
    this.showDemoEntry = !s.ready && s.indexedCount === 0 && s.pendingCount === 0;
    if (this.queryState === 'processing' && s.ready && s.pendingCount === 0) {
      this.queryState = 'idle';
      this.statusText = '资料已处理完成，可以提问了。';
    }
    this.submitPendingIntent();
  }

  // ------------------------------------------------------------------
  // 统一提交入口（手动 + 意图自动共用）
  // ------------------------------------------------------------------
  submitQuestion(raw: string): void {
    const q: string = raw.trim();
    if (q.length === 0) {
      this.statusText = '请输入问题后再发送。';
      return;
    }
    if (this.isBusy()) {
      return;
    }
    const rt: KnowledgeRuntime | null = this.runtime;
    if (rt === null) {
      this.queryState = 'loading';
      this.statusText = '课程资料库仍在初始化，请稍候。';
      return;
    }
    const idx: IndexStatus = rt.indexStatus();
    if (!idx.ready || idx.pendingCount > 0) {
      this.queryState = 'processing';
      this.statusText = '课程资料正在处理中，请稍候再试。';
      return;
    }

    // 取消上一个在途请求并领取新的请求编号。
    this.cancelInFlight();
    const seq: number = this.requestSeq;

    this.inputText = '';
    this.allowedSegmentIds = [];
    this.revisionBySegment = new Map();
    this.revisionByDocument = new Map();

    const userMsg: ChatMessage = {
      id: this.genId('u'),
      role: 'user',
      content: q,
      citations: [],
      status: 'done',
      error: '',
      retryQuestion: '',
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: this.genId('a'),
      role: 'assistant',
      content: '',
      citations: [],
      status: 'streaming',
      error: '',
      retryQuestion: q,
      createdAt: Date.now(),
    };
    this.messages = this.messages.concat([userMsg, assistantMsg]);
    this.streamIndex = this.messages.length - 1;

    this.queryState = 'retrieving';
    this.statusText = '正在检索课程资料…';
    this.scrollToBottom();
    void this.runFlow(seq, q);
  }

  private async runFlow(seq: number, q: string): Promise<void> {
    const rt: KnowledgeRuntime | null = this.runtime;
    if (rt === null) {
      return;
    }

    // 云端模式才需要网络预检；离线替身模式完全离线可跑。
    if (this.cloudMode) {
      const online: boolean = await this.isOnline();
      if (seq !== this.requestSeq) {
        return;
      }
      if (!online) {
        this.failWith('offline', '网络未连接，请检查网络后重试。', seq);
        return;
      }
    }

    let chunks: RetrievedChunk[] = [];
    try {
      chunks = await rt.container.retrieval.retrieve(q, 5);
    } catch (e) {
      // 检索期间被取消：请求编号已变，直接丢弃，不得继续发起回答。
      if (seq !== this.requestSeq) {
        return;
      }
      const code: ServiceError = (e instanceof ServiceException) ? (e as ServiceException).code : ServiceError.UNKNOWN;
      if (code === ServiceError.CANCELLED) {
        return;
      }
      if (code === ServiceError.INDEX_NOT_READY) {
        this.failWith('processing', '课程资料正在处理中，请稍候再试。', seq);
      } else if (code === ServiceError.EMPTY_RESULTS) {
        this.failWith('empty', '没有检索到与该问题相关的课程资料。', seq);
      } else if (code === ServiceError.OFFLINE) {
        this.failWith('offline', '网络未连接，请检查网络后重试。', seq);
      } else {
        this.failWith('error', this.errorTextFor(code), seq);
      }
      return;
    }

    // 检索完成 —— 再次校验取消标记。
    if (seq !== this.requestSeq) {
      return;
    }
    if (chunks.length === 0) {
      this.failWith('empty', '没有检索到与该问题相关的课程资料，请换一种方式提问。', seq);
      return;
    }

    await this.bindCitationContext(chunks);
    if (seq !== this.requestSeq) {
      return;
    }

    this.queryState = 'streaming';
    this.statusText = '正在生成回答…';

    const turn: ChatTurn = { question: q, segments: chunks };
    const handle: ChatHandle = rt.container.chat.ask(
      turn,
      (ev: StreamEventImpl): void => {
        this.onStreamEvent(seq, ev);
      },
      (): void => {
        this.onStreamComplete(seq);
      }
    );
    if (seq !== this.requestSeq) {
      // 极端竞态：handle 生成期间被取消。
      handle.cancel();
      return;
    }
    this.currentCancel = handle;
  }

  /** 记录本次检索片段的权威版本号，供引用版本绑定。 */
  private async bindCitationContext(chunks: RetrievedChunk[]): Promise<void> {
    const rt: KnowledgeRuntime | null = this.runtime;
    if (rt === null) {
      return;
    }
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c: RetrievedChunk = chunks[i];
      ids.push(c.segmentId);
      if (!this.revisionByDocument.has(c.documentId)) {
        const doc = await rt.knowledge.getDocument(c.documentId);
        if (doc !== null) {
          this.revisionByDocument.set(c.documentId, doc.revision);
        }
      }
      const seg = await rt.knowledge.getSegment(c.segmentId);
      if (seg !== null) {
        this.revisionBySegment.set(c.segmentId, seg.documentRevision);
      }
    }
    this.allowedSegmentIds = ids;
  }

  // ------------------------------------------------------------------
  // 流式事件
  // ------------------------------------------------------------------
  private onStreamEvent(seq: number, ev: StreamEventImpl): void {
    if (seq !== this.requestSeq) {
      return; // 旧请求回调不得污染新回答
    }
    if (ev.kind === 'token') {
      this.appendToken(ev.text);
      return;
    }
    if (ev.kind === 'citation') {
      const c: SourceCitation | null = ev.citation;
      if (c !== null) {
        this.addCitation(c);
      }
      return;
    }
    if (ev.kind === 'retrieving') {
      if (this.queryState === 'retrieving') {
        this.queryState = 'streaming';
        this.statusText = '正在生成回答…';
      }
      return;
    }
    if (ev.kind === 'done') {
      this.completeAnswer(seq);
      return;
    }
    if (ev.kind === 'error') {
      this.onStreamError(ev);
    }
  }

  /** chat 服务收口（完成 / 取消 / 失败都只回调一次）。 */
  private onStreamComplete(seq: number): void {
    if (seq !== this.requestSeq) {
      return;
    }
    this.currentCancel = null;
    if (this.queryState === 'streaming' || this.queryState === 'retrieving') {
      this.completeAnswer(seq);
    }
  }

  private onStreamError(ev: StreamEventImpl): void {
    const msg: string = ev.message.length > 0 ? ev.message : '回答生成失败，请重试。';
    if (ev.errorKind === 'network') {
      this.failWith('offline', '网络不可用，请检查网络后重试。', this.requestSeq);
    } else if (ev.errorKind === 'timeout') {
      this.failWith('error', '云端请求超时，请重试。', this.requestSeq);
    } else if (ev.errorKind === 'parse') {
      this.failWith('error', '回答解析失败，请重试。', this.requestSeq);
    } else {
      this.failWith('error', msg, this.requestSeq);
    }
  }

  private appendToken(text: string): void {
    if (text.length === 0) {
      return;
    }
    const i: number = this.streamIndex;
    if (i < 0 || i >= this.messages.length) {
      return;
    }
    const cur: ChatMessage = this.messages[i];
    const next: ChatMessage = {
      id: cur.id,
      role: cur.role,
      content: cur.content + text,
      citations: cur.citations,
      status: 'streaming',
      error: '',
      retryQuestion: cur.retryQuestion,
      createdAt: cur.createdAt,
    };
    this.replaceMessage(i, next);
    this.scrollToBottom();
  }

  private addCitation(raw: SourceCitation): void {
    // 引用必须命中本次检索的片段，否则丢弃（防模型幻觉引用）。
    if (!this.containsId(this.allowedSegmentIds, raw.segmentId)) {
      return;
    }
    const i: number = this.streamIndex;
    if (i < 0 || i >= this.messages.length) {
      return;
    }
    const cur: ChatMessage = this.messages[i];
    for (let k = 0; k < cur.citations.length; k++) {
      if (cur.citations[k].segmentId === raw.segmentId) {
        return; // 去重
      }
    }

    // 版本以资料库读出的权威值为准。
    let revision: number = raw.documentRevision;
    const mapped: number | undefined = this.revisionBySegment.get(raw.segmentId);
    if (mapped !== undefined) {
      revision = mapped;
    } else if (revision <= 0) {
      const docRev: number | undefined = this.revisionByDocument.get(raw.documentId);
      if (docRev !== undefined) {
        revision = docRev;
      }
    }

    const full: SourceCitation = {
      documentId: raw.documentId,
      documentRevision: revision,
      segmentId: raw.segmentId,
      documentTitle: raw.documentTitle,
      source: raw.source,
      excerpt: raw.excerpt,
    };
    const next: ChatMessage = {
      id: cur.id,
      role: cur.role,
      content: cur.content,
      citations: cur.citations.concat([full]),
      status: cur.status,
      error: cur.error,
      retryQuestion: cur.retryQuestion,
      createdAt: cur.createdAt,
    };
    this.replaceMessage(i, next);
  }

  private completeAnswer(seq: number): void {
    if (seq !== this.requestSeq) {
      return;
    }
    const i: number = this.streamIndex;
    if (i < 0 || i >= this.messages.length) {
      this.queryState = 'complete';
      this.statusText = '';
      this.currentCancel = null;
      return;
    }
    const cur: ChatMessage = this.messages[i];
    const next: ChatMessage = {
      id: cur.id,
      role: cur.role,
      content: cur.content,
      citations: cur.citations,
      status: 'done',
      error: '',
      retryQuestion: cur.retryQuestion,
      createdAt: cur.createdAt,
    };
    this.replaceMessage(i, next);
    this.streamIndex = -1;
    this.currentCancel = null;

    if (cur.content.trim().length === 0) {
      this.queryState = 'empty';
      this.statusText = '未检索到与该问题相关的课程内容。';
    } else {
      this.queryState = 'complete';
      this.statusText = '回答完成';
    }
    this.scrollToBottom();
  }

  private failWith(state: QueryState, text: string, seq: number): void {
    if (seq !== this.requestSeq) {
      return;
    }
    this.queryState = state;
    this.statusText = text;
    const i: number = this.streamIndex;
    if (i >= 0 && i < this.messages.length) {
      const cur: ChatMessage = this.messages[i];
      const next: ChatMessage = {
        id: cur.id,
        role: cur.role,
        content: cur.content,
        citations: cur.citations,
        status: 'error',
        error: text,
        retryQuestion: cur.retryQuestion,
        createdAt: cur.createdAt,
      };
      this.replaceMessage(i, next);
    }
    this.currentCancel = null;
    this.scrollToBottom();
  }

  // ------------------------------------------------------------------
  // 取消 / 重试
  // ------------------------------------------------------------------
  /** 请求编号 +1 并中止在途网络请求：使旧回调全部失效。 */
  private cancelInFlight(): void {
    this.requestSeq = this.requestSeq + 1;
    if (this.currentCancel !== null) {
      this.currentCancel.cancel();
      this.currentCancel = null;
    }
  }

  private handleCancel(): void {
    this.cancelInFlight();
    const i: number = this.streamIndex;
    if (i >= 0 && i < this.messages.length) {
      const cur: ChatMessage = this.messages[i];
      const next: ChatMessage = {
        id: cur.id,
        role: cur.role,
        content: cur.content.length > 0 ? cur.content : '（已取消）',
        citations: cur.citations,
        status: 'done',
        error: '',
        retryQuestion: cur.retryQuestion,
        createdAt: cur.createdAt,
      };
      this.replaceMessage(i, next);
    }
    this.streamIndex = -1;
    this.queryState = 'idle';
    this.statusText = '已取消当前请求';
  }

  /** 重试复用原问题；旧请求编号已失效，回调不会污染新回答。 */
  private handleRetry(): void {
    let q: string = '';
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m: ChatMessage = this.messages[i];
      if (m.role === 'assistant' && m.retryQuestion.length > 0) {
        q = m.retryQuestion;
        break;
      }
    }
    if (q.length === 0) {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        if (this.messages[i].role === 'user') {
          q = this.messages[i].content;
          break;
        }
      }
    }
    if (q.length === 0) {
      return;
    }
    // 丢掉尾部失败 / 空的 assistant 消息，避免重复展示。
    while (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant') {
      this.messages = this.messages.slice(0, this.messages.length - 1);
    }
    this.inputText = q;
    this.submitQuestion(q);
  }

  /** 明确的演示入口：仅在索引为空时可用。 */
  private handleDemoEntry(): void {
    const rt: KnowledgeRuntime | null = this.runtime;
    if (rt === null) {
      return;
    }
    this.cancelInFlight();
    seedDemoDocuments(rt.container);
    this.statusText = '已载入演示资料，正在建立索引…';
    this.showDemoEntry = false;
  }

  // ------------------------------------------------------------------
  // 引用跳转
  // ------------------------------------------------------------------
  private openSource(c: SourceCitation): void {
    const params: SourceRouteParams = {
      documentId: c.documentId,
      segmentId: c.segmentId,
      documentRevision: c.documentRevision,
    };
    try {
      this.getUIContext().getRouter().pushUrl({ url: 'pages/SourceDetail', params: params });
    } catch (e) {
      this.statusText = '原文打开失败，请重试。';
    }
  }

  // ------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------
  private genId(prefix: string): string {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  }

  private replaceMessage(index: number, msg: ChatMessage): void {
    const next: ChatMessage[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      next.push(i === index ? msg : this.messages[i]);
    }
    this.messages = next;
  }

  private containsId(list: string[], id: string): boolean {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === id) {
        return true;
      }
    }
    return false;
  }

  private isBusy(): boolean {
    return this.queryState === 'loading' || this.queryState === 'processing'
      || this.queryState === 'retrieving' || this.queryState === 'streaming';
  }

  private isQuerying(): boolean {
    return this.queryState === 'retrieving' || this.queryState === 'streaming';
  }

  private canRetry(): boolean {
    if (this.queryState !== 'error' && this.queryState !== 'empty' && this.queryState !== 'offline') {
      return false;
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m: ChatMessage = this.messages[i];
      if (m.role === 'assistant' && m.retryQuestion.length > 0) {
        return true;
      }
    }
    return false;
  }

  private isOnline(): Promise<boolean> {
    return new Promise<boolean>((resolve: (v: boolean) => void): void => {
      try {
        connection.hasDefaultNet().then((has: boolean): void => {
          resolve(has);
        }).catch((): void => {
          resolve(false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  private errorTextFor(code: ServiceError): string {
    switch (code) {
      case ServiceError.OFFLINE: return '网络不可用，请检查后重试';
      case ServiceError.TIMEOUT: return '请求超时，请重试';
      case ServiceError.AUTH_FAILURE: return '云端鉴权失败';
      case ServiceError.RATE_LIMIT: return '请求过于频繁，请稍后再试';
      case ServiceError.INDEX_NOT_READY: return '索引尚未就绪，请稍后再试';
      case ServiceError.EMPTY_RESULTS: return '未找到相关资料';
      case ServiceError.INVALID_ARGUMENT: return '问题不合法，请重新输入';
      default: return '请求失败，请重试';
    }
  }

  private stateLabel(): string {
    switch (this.queryState) {
      case 'loading': return '初始化';
      case 'processing': return '资料处理中';
      case 'retrieving': return '检索中';
      case 'streaming': return '输出中';
      case 'complete': return '完成';
      case 'offline': return '断网';
      case 'empty': return '无相关内容';
      case 'error': return '请求失败';
      default: return '就绪';
    }
  }

  private stateColor(): string {
    switch (this.queryState) {
      case 'offline':
      case 'error': return '#B42318';
      case 'empty': return '#B45309';
      case 'complete': return '#0E9F6E';
      case 'loading':
      case 'processing':
      case 'retrieving':
      case 'streaming': return '#1570EF';
      default: return '#526170';
    }
  }

  private scrollToBottom(): void {
    setTimeout((): void => {
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (e) {
        // 忽略滚动异常
      }
    }, 30);
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  @Builder
  MessageBubble(msg: ChatMessage) {
    Column({ space: 6 }) {
      if (msg.role === 'user') {
        Row() {
          Blank()
          Text(msg.content)
            .fontSize(15)
            .fontColor('#111827')
            .padding(12)
            .backgroundColor('#E8F3FF')
            .borderRadius(12)
        }.width('100%')
      } else {
        Row() {
          Column({ space: 6 }) {
            Text(msg.content.length > 0 ? msg.content : this.placeholderFor(msg))
              .fontSize(15)
              .lineHeight(24)
              .fontColor('#1F2937')
              .width('100%')
            if (msg.citations.length > 0) {
              Text('引用来源（点击查看原文）')
                .fontSize(12).fontColor('#7A8696')
                .margin({ top: 4 })
              ForEach(msg.citations, (c: SourceCitation, idx: number) => {
                Column({ space: 2 }) {
                  Text('[' + (idx + 1) + '] ' + c.documentTitle + ' · v' + c.documentRevision)
                    .fontSize(13).fontColor('#1570EF').fontWeight(FontWeight.Medium)
                    .width('100%')
                  Text(c.excerpt)
                    .fontSize(12).fontColor('#526170')
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                }
                .width('100%')
                .padding(8)
                .backgroundColor('#F3F6FA')
                .borderRadius(8)
                .onClick(() => {
                  this.openSource(c);
                })
              }, (c: SourceCitation, idx: number) => c.segmentId + '_' + idx)
            }
            if (msg.status === 'error' && msg.error.length > 0) {
              Text(msg.error).fontSize(12).fontColor('#B42318').width('100%')
            }
          }
          .width('82%')
          .padding(12)
          .backgroundColor('#FFFFFF')
          .borderRadius(12)
          .borderWidth(1)
          .borderColor('#E6EBF2')
          Blank()
        }.width('100%')
      }
    }
    .width('100%')
  }

  private placeholderFor(msg: ChatMessage): string {
    if (msg.id === (this.streamIndex >= 0 && this.streamIndex < this.messages.length
      ? this.messages[this.streamIndex].id : '')) {
      if (this.queryState === 'retrieving') {
        return '正在检索课程资料…';
      }
      return '正在生成回答…';
    }
    return '（无内容）';
  }

  build() {
    Column() {
      // 顶部
      Row() {
        Button('返回').type(ButtonType.Normal).height(32)
          .onClick(() => {
            this.getUIContext().getRouter().back();
          })
        Text('课程知识问答').fontSize(20).fontWeight(FontWeight.Bold).margin({ left: 12 })
        Blank()
        if (this.isQuerying()) {
          Button('取消').type(ButtonType.Normal).height(32)
            .onClick(() => {
              this.handleCancel();
            })
        }
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 6 })

      // 状态区：初始化 / 资料处理中 / 检索中 / 输出中 / 完成 / 断网 / 无结果 / 失败
      Column({ space: 4 }) {
        Row() {
          Text(this.stateLabel())
            .fontSize(12)
            .fontColor(this.stateColor())
            .fontWeight(FontWeight.Medium)
            .backgroundColor('#EEF2F7')
            .borderRadius(4)
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          Blank()
          Text(this.indexText).fontSize(11).fontColor('#7A8696')
        }.width('100%')
        if (this.statusText.length > 0) {
          Row() {
            if (this.isBusy()) {
              LoadingProgress().width(16).height(16).color('#1570EF').margin({ right: 6 })
            }
            Text(this.statusText).fontSize(13).fontColor('#526170').layoutWeight(1)
            if (this.canRetry()) {
              Button('重试').type(ButtonType.Normal).height(28).fontSize(13)
                .onClick(() => {
                  this.handleRetry();
                })
            }
          }.width('100%')
        }
      }.width('100%').padding({ left: 16, right: 16, bottom: 8 })

      // 会话消息列表（保留历史，流式更新当前回答）
      Scroll(this.scroller) {
        Column({ space: 12 }) {
          if (this.messages.length === 0) {
            Column({ space: 8 }) {
              Text('你好，我是课程知识助手').fontSize(17).fontWeight(FontWeight.Bold)
              Text('我会只依据课程资料库中的内容作答，并给出可追溯的引用。')
                .fontSize(13).fontColor('#7A8696').textAlign(TextAlign.Center)
              if (this.showDemoEntry) {
                Text('当前资料库为空。可载入演示资料用于体验流程。')
                  .fontSize(12).fontColor('#B45309').textAlign(TextAlign.Center)
                Button('载入演示资料').type(ButtonType.Normal).height(32)
                  .onClick(() => {
                    this.handleDemoEntry();
                  })
              }
            }.width('100%').padding({ top: 60, left: 24, right: 24 })
          } else {
            ForEach(this.messages, (m: ChatMessage) => {
              this.MessageBubble(m)
            }, (m: ChatMessage) => m.id + '|' + m.content.length + '|'
              + m.citations.length + '|' + m.status + '|' + m.error.length)
          }
        }.width('100%').padding(16)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Auto)

      // 输入区
      Column({ space: 8 }) {
        TextArea({ placeholder: '例如：心脏的四个腔室分别是什么？', text: this.inputText })
          .width('100%')
          .height(76)
          .backgroundColor('#FFFFFF')
          .borderRadius(10)
          .enabled(!this.isBusy())
          .onChange((v: string) => {
            this.inputText = v;
          })
        Row() {
          Text('回答与引用来自同一次检索').fontSize(11).fontColor('#9AA5B1')
          Blank()
          Button('发送')
            .enabled(!this.isBusy() && this.inputText.trim().length > 0)
            .onClick(() => {
              this.submitQuestion(this.inputText);
            })
        }.width('100%')
      }.width('100%').padding(16).backgroundColor('#FFFFFF')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F7FA')
  }
}
