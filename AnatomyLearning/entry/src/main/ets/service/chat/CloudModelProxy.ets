// CFKit 云函数转发层（生产实现）。
//
// 架构：客户端 → CloudModelProxy → CFKit 云函数 → 模型供应商 API
// 密钥全部保存在云端；客户端仅持有云函数 URL。
//
// 流式协议（云函数 → 客户端 SSE）：
//   Content-Type: text/event-stream; charset=utf-8
//   事件块分隔：\n\n（同时兼容 \r\n\r\n）
//   行格式：event:<type>\ndata:<string-or-json>
//   event 取值：message_start | citation | token | message_end | error
//   data 字段：
//     message_start / message_end → 忽略 data
//     token → 纯文本字符串
//     citation → { segmentId, index?, excerpt? } JSON；客户端按本次检索片段校验并补全
//     error → { code, message } JSON
//
// 依赖：@kit.NetworkKit（http）+ @ohos.util（TextDecoder）。
// 参考：entry/src/main/ets/model/QAService.ets 的 HTTP + SSE 处理模式。

import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import util from '@ohos.util';
import { SourceCitation, RetrievedChunk } from '../../model/Knowledge';
import {
  IChatService, ChatTurn, ChatHandle,
  StreamEventImpl, StreamErrorKind, ServiceError, ServiceException
} from '../types';

// HarmonyOS SDK 5.x 的 http.HttpRequest.on() 事件名联合类型过窄，
// 运行时确实支持 dataReceive / headersReceive / dataEnd。
// 这里声明一个独立的宽松接口，用 as object as 绕过 SDK 的过窄类型。
interface HttpStreamRequest {
  on(event: string, cb: () => void): void;
  on(event: string, cb: (err?: BusinessError, data?: ArrayBuffer) => void): void;
  off(event: string): void;
  requestInStream(url: string, options: http.HttpRequestOptions): Promise<number>;
  destroy(): void;
}

export interface CloudModelProxyOptions {
  functionUrl: string;
  defaultModel: string;
  timeoutMs?: number;
  /** 演示模式：失败时自动回退到 TestCloudModelService；emitRetrieving 标记 [demo mode] */
  demoMode?: boolean;
}

interface ResolvedOptions {
  functionUrl: string;
  defaultModel: string;
  timeoutMs: number;
  demoMode: boolean;
}

// ---------------------------------------------------------------------------
// 手动 UTF-8 边界检测 —— 绕过 SDK TextDecoder 的 stream 字面量类型限制
//
// 问题：ArkTS 严格模式下 @ohos.util.TextDecoder.decode() 第二个参数
// 的类型签名是 { stream?: false }（字面量 false），不允许传 true。
// 不传 stream 参数意味着 SDK 会把不完整的多字节字符替换为 U+FFFD，
// 当一个中文字符（3 字节）被 TCP 切在两个包之间时会产生乱码。
//
// 方案：手动追踪 bytes 队列，只在完整 UTF-8 序列边界上调用 decode()。
// UTF-8 编码规则：
//   ASCII:   0xxxxxxx (0x00-0x7F)          — 单字节
//   2 字节:  110xxxxx 10xxxxxx              — 0xC0-0xDF 开头 + 1 续字节
//   3 字节:  1110xxxx 10xxxxxx 10xxxxxx     — 0xE0-0xEF 开头 + 2 续字节
//   4 字节:  11110xxx 10xxxxxx 10xxxxxx 10xxxxxx — 0xF0-0xF7 开头 + 3 续字节
//   续字节:  10xxxxxx (0x80-0xBF)
// ---------------------------------------------------------------------------

/**
 * 从后往前找 bytes 队列中最后一个完整 UTF-8 序列的边界位置。
 * 返回边界之后第一个待 decode 的 index（完整序列的末尾 + 1）。
 * 如果没有完整序列返回 0。
 */
function findUtf8CompleteBoundary(bytes: number[]): number {
  let i = bytes.length - 1;
  while (i >= 0) {
    const b = bytes[i];
    if (b < 0x80) {
      // ASCII — 自身完整
      return i + 1;
    }
    if ((b & 0xC0) === 0x80) {
      // 续字节 — 往前找 lead byte
      i--;
      if (i < 0) return 0;
      continue;
    }
    // lead byte — 判断期望长度
    let expected = 1;
    if (b >= 0xC0 && b <= 0xDF) expected = 2;
    else if (b >= 0xE0 && b <= 0xEF) expected = 3;
    else if (b >= 0xF0 && b <= 0xF7) expected = 4;
    else { i--; continue; } // 无效 lead byte，跳过
    // 检查实际长度是否足够
    const actual = bytes.length - i;
    if (actual >= expected) {
      return i + expected;
    }
    // 不完整，继续往前
    i--;
  }
  return 0;
}

interface DecodeResult {
  text: string;
  queue: number[];
}

/**
 * 追加新 bytes 到队列，decode 所有完整 UTF-8 序列，
 * 保留末尾不完整的 bytes 到队列里等待下次。
 * 流结束时（flush=true）会把队列里残留的不完整 bytes 也一起 decode。
 */
function decodeUtf8Chunk(
  rawBytes: number[],
  newBytes: Uint8Array,
  decoder: util.TextDecoder,
  flush: boolean
): DecodeResult {
  // 追新 bytes
  for (let k = 0; k < newBytes.length; k++) {
    rawBytes.push(newBytes[k]);
  }

  if (rawBytes.length === 0) {
    const empty: DecodeResult = { text: '', queue: [] };
    return empty;
  }

  let boundary: number;
  if (flush) {
    // 流结束 — 全部 decode，不管是否完整（SDK 会替换无效序列）
    boundary = rawBytes.length;
  } else {
    boundary = findUtf8CompleteBoundary(rawBytes);
  }

  if (boundary === 0) {
    // 没有完整序列
    const noop: DecodeResult = { text: '', queue: rawBytes };
    return noop;
  }

  const toDecode = new Uint8Array(rawBytes.slice(0, boundary));
  const text = decoder.decode(toDecode);
  const remaining = rawBytes.slice(boundary);

  const result: DecodeResult = { text: text, queue: remaining };
  return result;
}

/**
 * 三重状态守卫，确保异步回调（dataReceive / dataEnd / .then / .catch）
 * 不会在请求终止后继续触发 UI 事件：
 *
 *   cancelled — 用户主动 cancel() 或超时触发
 *   errored   — 收到 HTTP / 协议 / SSE error 事件
 *   completed — 生命周期收口（finish() 只执行一次）
 *
 * 优先级：completed > cancelled > errored。
 * finish() 在 cancelled / errored 任一触发后都会被调用一次，
 * 后续任何回调发现 completed=true 直接 return。
 */
export class CloudModelProxy implements IChatService {
  private readonly opts: ResolvedOptions;

  constructor(opts: CloudModelProxyOptions) {
    const resolved: ResolvedOptions = {
      functionUrl: opts.functionUrl,
      defaultModel: opts.defaultModel,
      timeoutMs: opts.timeoutMs ?? 30000,
      demoMode: opts.demoMode ?? false,
    };
    this.opts = resolved;
  }

  ask(
    turn: ChatTurn,
    onEvent: (event: StreamEventImpl) => void,
    onComplete: () => void
  ): ChatHandle {
    let cancelled = false;
    let errored = false;
    let completed = false;
    let timeoutTimer = -1;

    const httpRequest = http.createHttp() as object as HttpStreamRequest;

    // ---- 清理 ----
    const offAll = (): void => {
      try { httpRequest.off('headersReceive'); } catch (_e) { /* ignore */ }
      try { httpRequest.off('dataReceive'); } catch (_e) { /* ignore */ }
      try { httpRequest.off('dataEnd'); } catch (_e) { /* ignore */ }
    };

    const destroyRequest = (): void => {
      try { httpRequest.destroy(); } catch (_e) { /* ignore */ }
    };

    const finish = (): void => {
      if (completed) return;
      completed = true;
      if (timeoutTimer !== -1) {
        clearTimeout(timeoutTimer);
        timeoutTimer = -1;
      }
      offAll();
      destroyRequest();
      onComplete();
    };

    const softCancel = (): void => {
      cancelled = true;
      destroyRequest();
    };

    // ---- 事件发射（带守卫） ----
    const emitEvent = (ev: StreamEventImpl): void => {
      if (completed || cancelled || errored) return;
      onEvent(ev);
    };

    const emitErrorGuarded = (errorKind: StreamErrorKind, message: string): void => {
      if (completed || cancelled) return;
      errored = true;
      emitEvent(StreamEventImpl.makeError(errorKind, message));
    };

    // ---- 超时定时器 ----
    timeoutTimer = setTimeout((): void => {
      if (completed) return;
      softCancel();
      emitErrorGuarded('timeout', '云端请求超时（' + this.opts.timeoutMs + 'ms）');
      finish();
    }, this.opts.timeoutMs);

    // ---- SSE 解析状态 ----
    const decoder = util.TextDecoder.create('utf-8');
    let buffer = '';
    let headersSeen = false;
    // 原始 bytes 队列 — 用于跨包 UTF-8 边界检测
    let rawBytesQueue: number[] = [];
    const proxy = this;

    const processSseBuffer = (): void => {
      // 用 \n\n 或 \r\n\r\n 切事件块
      let sepIdx = findEventBoundary(buffer);
      while (sepIdx !== -1) {
        const rawEvent = buffer.substring(0, sepIdx);
        const consumeLen = buffer.charCodeAt(sepIdx) === 0x0D ? 4 : 2;
        buffer = buffer.substring(sepIdx + consumeLen);
        dispatchSseEvent(rawEvent, onEvent, () => completed || cancelled || errored, (k, m) => { errored = true; emitEvent(StreamEventImpl.makeError(k, m)); }, turn.segments);
        sepIdx = findEventBoundary(buffer);
      }
    };

    // ---- 事件监听（先定义回调变量，再 .on() 注册 —— 对齐 QAService 模式）----
    const onHeadersReceive = (): void => {
      if (completed || cancelled) return;
      headersSeen = true;

      // HTTP 状态码检查延后到 .then(respCode) 里 —— headersReceive 阶段 responseCode 可能尚未就绪

      // 发射 retrieving 事件（带演示模式标记）
      if (this.opts.demoMode) {
        const ev = StreamEventImpl.makeRetrieving();
        ev.message = '[demo mode] ' + ev.message;
        emitEvent(ev);
      } else {
        emitEvent(StreamEventImpl.makeRetrieving());
      }

      // 客户端兜底 citation 绑定 —— 先把本次检索的片段元信息发出去
      proxy.emitClientCitations(turn.segments, emitEvent);
    };

    const onDataReceive = (_err: BusinessError | undefined, data: ArrayBuffer | undefined): void => {
      if (completed || cancelled || errored) return;
      if (data === undefined || data === null) return;
      // 跨包 UTF-8 安全解码（只在完整字符边界 decode）
      const newBytes: Uint8Array = new Uint8Array(data);
      const result = decodeUtf8Chunk(rawBytesQueue, newBytes, decoder, false);
      rawBytesQueue = result.queue;
      if (result.text.length > 0) {
        buffer += result.text;
        processSseBuffer();
      }
    };

    const onDataEnd = (): void => {
      if (completed || cancelled) return;

      // flush rawBytesQueue 里残留的不完整 bytes（流结束，全部完整）
      if (rawBytesQueue.length > 0) {
        const flushAll = new Uint8Array(rawBytesQueue);
        const result = decodeUtf8Chunk([], flushAll, decoder, true);
        rawBytesQueue = [];
        if (result.text.length > 0) {
          buffer += result.text;
        }
      }

      if (buffer.length > 0) {
        processSseBuffer();
        // 若还有未完成的残留（最后一个事件块不以 \n\n 结尾），强制 dispatch
        if (buffer.trim().length > 0) {
          dispatchSseEvent(buffer, onEvent, () => completed || cancelled || errored, (k, m) => { errored = true; emitEvent(StreamEventImpl.makeError(k, m)); }, turn.segments);
          buffer = '';
        }
      }
      if (!errored) {
        emitEvent(StreamEventImpl.makeDone());
      }
      finish();
    };

    httpRequest.on('headersReceive', onHeadersReceive);
    httpRequest.on('dataReceive', onDataReceive);
    httpRequest.on('dataEnd', onDataEnd);

    // ---- 发起请求 ----
    const bodyObj = buildRequestBody(turn, this.opts);
    httpRequest.requestInStream(this.opts.functionUrl, {
      method: http.RequestMethod.POST,
      header: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      extraData: JSON.stringify(bodyObj),
      connectTimeout: 15000,
      readTimeout: this.opts.timeoutMs,
    }).then((respCode: number): void => {
      if (completed || cancelled) return;
      if (respCode < 200 || respCode >= 300) {
        const svcErr = mapHttpStatus(respCode);
        softCancel();
        emitErrorGuarded(mapToStreamError(svcErr.code), svcErr.message);
        finish();
      }
    }).catch((businessError: BusinessError): void => {
      if (completed || cancelled) return;
      const svcErr = toServiceException(businessError);
      if (svcErr.code === ServiceError.TIMEOUT) {
        emitErrorGuarded('timeout', '请求超时');
      } else if (svcErr.code === ServiceError.OFFLINE) {
        emitErrorGuarded('network', '网络不可用，请检查后重试');
      } else {
        emitErrorGuarded('request', svcErr.message);
      }
      finish();
    });

    const handle: ChatHandle = {
      cancel: (): void => {
        if (completed) return;
        softCancel();
        finish();
      }
    };
    return handle;
  }

  /**
   * 客户端兜底 citation 发射：在收到 headers 后立即把本次 turn.segments
   * 中的每个片段都 emit 为 citation 事件，保证即使云函数不发 citation 也能
   * 正确展示引用（参考 TestCloudModelService 的行为）。
   */
  private emitClientCitations(
    segments: RetrievedChunk[],
    emitEvent: (ev: StreamEventImpl) => void
  ): void {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const excerpt = seg.text.length > 60 ? seg.text.substring(0, 60) + '...' : seg.text;
      const c: SourceCitation = {
        documentId: seg.documentId,
        documentRevision: seg.documentRevision ?? 0,
        segmentId: seg.segmentId,
        documentTitle: seg.documentTitle,
        source: seg.source,
        excerpt: excerpt,
      };
      emitEvent(StreamEventImpl.makeCitation(c));
    }
  }
}

// ---------------------------------------------------------------------------
// SSE 解析工具（模块级纯函数，方便单元测试）
// ---------------------------------------------------------------------------

/** 查找事件块边界：\n\n 或 \r\n\r\n */
function findEventBoundary(buf: string): number {
  const crlfIdx = buf.indexOf('\r\n\r\n');
  const lfIdx = buf.indexOf('\n\n');
  if (crlfIdx === -1) return lfIdx;
  if (lfIdx === -1) return crlfIdx;
  return crlfIdx < lfIdx ? crlfIdx : lfIdx;
}

interface DispatchResult {
  suppressedByGuard?: boolean;
  errored?: boolean;
}

/**
 * 解析单个 SSE 事件块并翻译为 StreamEventImpl。
 *
 * @param rawEvent       事件块原始文本（不含 \n\n 分隔符）
 * @param onEvent        UI 回调
 * @param isCancelled    状态守卫函数（返回 true 表示应丢弃）
 * @param onError        错误发生时调用（设置 errored flag）
 * @param segments       本次检索命中的片段；citation 据此校验补全（未命中则丢弃）
 */
export function dispatchSseEvent(
  rawEvent: string,
  onEvent: (ev: StreamEventImpl) => void,
  isCancelled: () => boolean,
  onError: (kind: StreamErrorKind, msg: string) => void,
  segments?: RetrievedChunk[]
): DispatchResult {
  const result: DispatchResult = {};
  // 解析 event: 和 data: 行
  let eventType = 'token';
  let dataLines: string[] = [];
  const lines = rawEvent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 空行跳过
    if (line.length === 0) continue;
    // event: 行 — SSE 规范：event 行只能出现一次，取最后一个
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
      continue;
    }
    // data: 行 — SSE 规范：多个 data 行用 \n 拼接，冒号后最多去掉一个前导空格
    if (line.startsWith('data:')) {
      let payload = line.substring(5);
      if (payload.length > 0 && payload.charCodeAt(0) === 0x20) {
        payload = payload.substring(1); // 只去掉一个前导空格
      }
      dataLines.push(payload);
      continue;
    }
    // 其他行（注释 :xxx、retry 等）忽略
  }
  const data = dataLines.join('\n');

  // 状态守卫
  if (isCancelled()) { result.suppressedByGuard = true; return result; }

  switch (eventType) {
    case 'token':
      if (data.length === 0) break;
      onEvent(StreamEventImpl.makeToken(data));
      break;

    case 'citation': {
      // 云端只回 { segmentId, index?, excerpt? }；引用一律按本次检索片段校验并补全，
      // 未命中本次检索片段的 citation 直接丢弃（防模型幻觉引用）。
      const c: SourceCitation | null = resolveCitationEvent(data, segments);
      if (c !== null) {
        onEvent(StreamEventImpl.makeCitation(c));
      }
      break;
    }

    case 'error': {
      // 尝试解析为结构化错误 { code, message }
      let errMsg = data;
      let errKind: StreamErrorKind = 'request';
      try {
        const obj = JSON.parse(data) as Record<string, Object>;
        if (obj && typeof obj.message === 'string') errMsg = obj.message as string;
        if (obj && typeof obj.code === 'string') errKind = classifyErrorKind(obj.code as string);
      } catch (_e) { /* 纯文本错误消息 */ }
      onError(errKind, errMsg);
      onEvent(StreamEventImpl.makeError(errKind, errMsg));
      result.errored = true;
      break;
    }

    case 'message_start':
      // 客户端已通过 headersReceive 发射 retrieving，这里忽略
      break;

    case 'message_end':
      // dataEnd 会发射 done，这里忽略
      break;

    default:
      // 未知事件类型静默忽略
      break;
  }
  return result;
}

/** 云端 citation 事件原始载荷：只信 segmentId / index，其余字段由客户端按检索片段补全。 */
interface CloudCitationPayload {
  segmentId?: string;
  index?: number;
  excerpt?: string;
}

/**
 * 把云端 citation 载荷解析为权威 SourceCitation：
 *   - 按 segmentId 命中本次检索片段（缺失时按 index 兜底，兼容 0/1-based）；
 *   - documentId / documentTitle / source / documentRevision 一律取自命中的 RetrievedChunk；
 *   - excerpt 取云端提供的值，缺省时用片段文本截断；
 *   - 未命中本次检索片段 → 返回 null，上层直接丢弃（防模型幻觉引用）。
 */
function resolveCitationEvent(data: string, segments?: RetrievedChunk[]): SourceCitation | null {
  let payload: CloudCitationPayload | null = null;
  try {
    const parsed: Object = JSON.parse(data);
    if (!parsed) {
      return null;
    }
    payload = parsed as CloudCitationPayload;
  } catch (_e) {
    return null;
  }
  if (payload === null) {
    return null;
  }

  const list: RetrievedChunk[] = segments ?? [];
  let hit: RetrievedChunk | null = null;

  const sid: string = typeof payload.segmentId === 'string' ? payload.segmentId : '';
  if (sid.length > 0) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].segmentId === sid) {
        hit = list[i];
        break;
      }
    }
  }
  if (hit === null) {
    const rawIndex: number = typeof payload.index === 'number' ? payload.index : -1;
    if (rawIndex >= 0) {
      if (rawIndex < list.length) {
        hit = list[rawIndex];
      } else if (rawIndex - 1 >= 0 && rawIndex - 1 < list.length) {
        hit = list[rawIndex - 1];
      }
    }
  }
  if (hit === null) {
    return null;
  }

  const text: string = hit.text;
  const exc: string = typeof payload.excerpt === 'string' ? payload.excerpt : '';
  const excerpt: string = exc.length > 0 ? exc : (text.length > 60 ? text.substring(0, 60) + '...' : text);

  const c: SourceCitation = {
    documentId: hit.documentId,
    documentRevision: hit.documentRevision ?? 0,
    segmentId: hit.segmentId,
    documentTitle: hit.documentTitle,
    source: hit.source,
    excerpt: excerpt,
  };
  return c;
}

function classifyErrorKind(code: string): StreamErrorKind {
  switch (code) {
    case 'network':
    case 'offline': return 'network';
    case 'timeout': return 'timeout';
    case 'parse': return 'parse';
    default: return 'request';
  }
}

// ---------------------------------------------------------------------------
// 请求体构建与错误映射
// ---------------------------------------------------------------------------

interface CloudSegmentMeta {
  documentId: string;
  documentTitle: string;
  source: string;
  segmentId: string;
  segmentIndex: number;
}

interface CloudRequestBody {
  model: string;
  functionId: string;
  prompt: string;
  segments: CloudSegmentMeta[];
  stream: boolean;
}

function buildRequestBody(turn: ChatTurn, opts: ResolvedOptions): CloudRequestBody {
  const segments: CloudSegmentMeta[] = turn.segments.map((s: RetrievedChunk): CloudSegmentMeta => ({
    documentId: s.documentId,
    documentTitle: s.documentTitle,
    source: s.source,
    segmentId: s.segmentId,
    segmentIndex: s.segmentIndex,
  }));
  const body: CloudRequestBody = {
    model: turn.model ?? opts.defaultModel,
    functionId: turn.cloudFunctionId ?? '',
    prompt: buildPrompt(turn.question, turn.segments),
    segments: segments,
    stream: true,
  };
  return body;
}

function buildPrompt(question: string, segments: RetrievedChunk[]): string {
  const citations = segments.map((s: RetrievedChunk, i: number): string => {
    return '[' + (i + 1) + '] ' + s.documentTitle + '\n' + s.text;
  }).join('\n\n');
  return '你是一位解剖学课程答疑助手。请严格基于以下参考片段回答，每个事实后标注 [1][2] 等引用编号。片段不足时请说"现有资料不足以回答"。\n\n--- 参考片段 ---\n' + citations + '\n---\n\n用户问题：' + question + '\n\n回答：';
}

function mapHttpStatus(status: number): ServiceException {
  switch (status) {
    case 400: return new ServiceException(ServiceError.INVALID_ARGUMENT, '请求参数不合法（HTTP 400）');
    case 401: return new ServiceException(ServiceError.AUTH_FAILURE, '鉴权失败（HTTP 401）');
    case 403: return new ServiceException(ServiceError.AUTH_FAILURE, '没有访问权限（HTTP 403）');
    case 404: return new ServiceException(ServiceError.OFFLINE, '云函数不存在（HTTP 404）');
    case 429: return new ServiceException(ServiceError.RATE_LIMIT, '请求过于频繁，请稍后再试（HTTP 429）');
    case 503: return new ServiceException(ServiceError.OFFLINE, '云端暂时不可用（HTTP 503）');
    default: return new ServiceException(ServiceError.MODEL_ERROR, '服务器返回异常（HTTP ' + status + '）');
  }
}

function mapToStreamError(code: ServiceError): StreamErrorKind {
  switch (code) {
    case ServiceError.OFFLINE: return 'network';
    case ServiceError.TIMEOUT: return 'timeout';
    case ServiceError.MODEL_ERROR: return 'parse';
    default: return 'request';
  }
}

function toServiceException(e: Error): ServiceException {
  if (e instanceof ServiceException) return e;
  const msg: string = e instanceof Error ? e.message : String(e);
  if (/timeout|ETIMEDOUT/i.test(msg)) return new ServiceException(ServiceError.TIMEOUT, msg);
  if (/network|ECONNREFUSED|ENOTFOUND/i.test(msg)) return new ServiceException(ServiceError.OFFLINE, msg);
  return new ServiceException(ServiceError.MODEL_ERROR, msg);
}
