import { Want } from '@kit.AbilityKit';

export interface ConsumedResult {
  question: string;
  autoSubmit: boolean;
  requestId: string;
  seq: string;
}

// 单个 JSON 请求原子发布；已处理标识在当前应用进程内保留。
export class ArkAFIntent {
  static readonly PENDING_QUESTION_KEY: string = 'arkaf.pendingQuestion';
  private static processed: Set<string> = new Set<string>();

  /** 从 Want 中抽取 question。找不到返回 undefined。 */
  static extractQuestionFromWant(want: Want | undefined | null): string | undefined {
    if (!want || !want.parameters) {
      return undefined;
    }
    const raw = want.parameters['question'];
    if (typeof raw !== 'string') {
      return undefined;
    }
    const q: string = raw.trim();
    return q.length > 0 ? q : undefined;
  }

  /** 从 Want 中抽取 autoSubmit，默认 true。 */
  static extractAutoSubmit(want: Want | undefined | null): boolean {
    if (!want || !want.parameters) {
      return true;
    }
    const v = want.parameters['autoSubmit'];
    if (typeof v === 'boolean') {
      return v;
    }
    if (typeof v === 'string') {
      return v !== 'false';
    }
    return true;
  }

  /** 从 Want 中抽取 requestId；无则生成一个新的。 */
  static extractRequestId(want: Want | undefined | null): string | undefined {
    if (!want || !want.parameters) {
      return undefined;
    }
    const raw = want.parameters['requestId'];
    if (typeof raw !== 'string') {
      return undefined;
    }
    const r = raw.trim();
    return r.length > 0 ? r : undefined;
  }

  static hasPending(): boolean {
    return ArkAFIntent.consumePendingQuestion() !== undefined;
  }

  static publishQuestion(question: string, autoSubmit: boolean = true,
    requestId?: string): string | undefined {
    const trimmed = question.trim();
    if (trimmed.length === 0) return undefined;
    const seq = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const rid = requestId !== undefined && requestId.trim().length > 0 ? requestId.trim() : seq;
    if (ArkAFIntent.processed.has(rid)) return rid;
    const pending = ArkAFIntent.consumePendingQuestion();
    if (pending !== undefined && pending.requestId === rid) return rid;
    const request: ConsumedResult = { question: trimmed, autoSubmit: autoSubmit, requestId: rid, seq: seq };
    AppStorage.setOrCreate<string>(ArkAFIntent.PENDING_QUESTION_KEY, JSON.stringify(request));
    return rid;
  }

  // 保留请求直到页面确认受理，初始化失败或页面重建时仍可重试。
  static consumePendingQuestion(): ConsumedResult | undefined {
    const raw = AppStorage.get<string>(ArkAFIntent.PENDING_QUESTION_KEY);
    if (raw === undefined || raw.length === 0) return undefined;
    try {
      const request = JSON.parse(raw) as ConsumedResult;
      if (typeof request.question !== 'string' || request.question.trim().length === 0 ||
        typeof request.requestId !== 'string' || request.requestId.length === 0 ||
        typeof request.autoSubmit !== 'boolean' || typeof request.seq !== 'string') return undefined;
      if (ArkAFIntent.processed.has(request.requestId)) return undefined;
      return request;
    } catch (_e) {
      return undefined;
    }
  }

  static acknowledge(requestId: string): void {
    const pending = ArkAFIntent.consumePendingQuestion();
    ArkAFIntent.processed.add(requestId);
    if (pending !== undefined && pending.requestId === requestId) {
      ArkAFIntent.clearPendingQuestion();
    }
  }

  static clearPendingQuestion(): void {
    AppStorage.setOrCreate<string>(ArkAFIntent.PENDING_QUESTION_KEY, '');
  }
}
