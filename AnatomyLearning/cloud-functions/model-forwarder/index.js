// CFKit 云函数：问答模型转发（生产版）。
//
// 职责：
//   1. 接收客户端 prompt + segments + model 参数。
//   2. 根据 MODEL_PROVIDER 环境变量选择模型供应商，用云端密钥调用。
//   3. 先发 message_start + 所有 citation 事件（来自客户端传入的 segments）。
//   4. 把供应商的流式 SSE 响应翻译成统一格式吐给客户端。
//   5. 上游错误也翻译成 SSE error 事件，客户端统一处理。
//
// 密钥只在云端环境变量中配置，客户端不持有任何 API key。
//
// 环境变量（CFKit 控制台部署时配置）：
//   MODEL_PROVIDER   — doubao | dashscope | openai （默认 doubao）
//   API_KEY          — 供应商密钥
//   MODEL_ENDPOINT   — 可选，自定义 endpoint
//   DEFAULT_MODEL    — 可选，默认模型名
//   ALLOWED_MODELS   — 可选，逗号分隔的允许模型白名单

const http = require('@cfkit/runtime/http');

// ---------------------------------------------------------------------------
// 模型供应商适配层
// ---------------------------------------------------------------------------
const providers = {
  doubao: {
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    transform(body) {
      return {
        model: body.model || process.env.DEFAULT_MODEL || 'doubao-pro-32k',
        messages: [{ role: 'user', content: body.prompt }],
        stream: true,
      };
    },
    apiKey() { return process.env.API_KEY; },
    streamParser(rawLine) {
      if (!rawLine.startsWith('data:')) return null;
      const payload = rawLine.slice(5).trim();
      if (payload === '[DONE]') return { done: true };
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content ? obj.choices[0].delta.content : '';
        return { token: delta };
      } catch (e) {
        return null;
      }
    },
  },
  dashscope: {
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    transform(body) {
      return {
        model: body.model || process.env.DEFAULT_MODEL || 'qwen-turbo',
        input: { prompt: body.prompt },
        parameters: { result_format: 'message_stream' },
      };
    },
    apiKey() { return process.env.API_KEY; },
    streamParser(rawLine) {
      if (!rawLine.startsWith('data:')) return null;
      try {
        const obj = JSON.parse(rawLine.slice(5).trim());
        const delta = obj.output && obj.output.choices && obj.output.choices[0] && obj.output.choices[0].message && obj.output.choices[0].message.content ? obj.output.choices[0].message.content : '';
        return { token: delta };
      } catch (e) {
        return null;
      }
    },
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    transform(body) {
      return {
        model: body.model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: body.prompt }],
        stream: true,
      };
    },
    apiKey() { return process.env.API_KEY; },
    streamParser(rawLine) {
      if (!rawLine.startsWith('data:')) return null;
      const payload = rawLine.slice(5).trim();
      if (payload === '[DONE]') return { done: true };
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content ? obj.choices[0].delta.content : '';
        return { token: delta };
      } catch (e) {
        return null;
      }
    },
  },
};

// ---------------------------------------------------------------------------
// SSE 输出辅助
// ---------------------------------------------------------------------------

/**
 * 向客户端写一个 SSE 事件块。
 * 格式：event:<type>\ndata:<payload>\n\n
 * data 只去掉一个前导空格，不 trim —— 避免损坏 token 文本中的空格/换行。
 */
function sse(res, eventType, data) {
  res.write('event:' + eventType + '\n');
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write('data:' + payload + '\n\n');
}

function mapProviderError(status) {
  if (status === 401 || status === 403) return 'auth_failure';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'model_error';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

exports.handler = async function (event, context) {
  const res = context.response;

  // ---- 基础校验 ----
  if (event.method !== 'POST') {
    res.statusCode = 405;
    res.end('method not allowed');
    return;
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) {
    res.statusCode = 400;
    res.end('invalid json');
    return;
  }

  if (!body.prompt || !body.prompt.trim()) {
    res.statusCode = 400;
    res.end('prompt is empty');
    return;
  }

  // 模型白名单校验
  const allowed = (process.env.ALLOWED_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length > 0 && body.model && allowed.indexOf(body.model) === -1) {
    res.statusCode = 400;
    res.end('model not allowed');
    return;
  }

  const providerName = process.env.MODEL_PROVIDER || 'doubao';
  const provider = providers[providerName];
  if (!provider) {
    res.statusCode = 500;
    res.end('unknown provider: ' + providerName);
    return;
  }
  if (!provider.apiKey()) {
    res.statusCode = 500;
    res.end('API key not configured on cloud');
    return;
  }

  // ---- 设置 SSE 响应头 ----
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ---- 先发 message_start ----
  sse(res, 'message_start', '');

  // ---- 再发所有 citation 事件（来自客户端传入的 segments）----
  const segments = Array.isArray(body.segments) ? body.segments : [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg && seg.segmentId && seg.documentId) {
      sse(res, 'citation', {
        documentId: seg.documentId,
        documentRevision: 0,
        segmentId: seg.segmentId,
        documentTitle: seg.documentTitle || '',
        source: seg.source || '',
        excerpt: '',
      });
    }
  }

  // ---- 调用上游模型 API ----
  try {
    const upstream = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + provider.apiKey(),
      },
      body: JSON.stringify(provider.transform(body)),
    });

    if (!upstream.ok) {
      sse(res, 'error', {
        code: mapProviderError(upstream.status),
        message: 'upstream HTTP ' + upstream.status,
      });
      res.end();
      return;
    }

    if (!upstream.body) {
      sse(res, 'error', { code: 'model_error', message: 'no body from upstream' });
      res.end();
      return;
    }

    // ---- 流式解析上游 SSE ----
    // 用 buffer 累积，按 \n\n 切事件块（同时处理 \r\n\r\n）
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const readResult = await reader.read();
      if (readResult.done) break;
      const value = readResult.value;
      if (value) buffer += decoder.decode(value, { stream: true });

      let sepIdx = findEventBoundary(buffer);
      while (sepIdx !== -1) {
        const rawEvent = buffer.substring(0, sepIdx);
        const consumeLen = buffer.charCodeAt(sepIdx) === 0x0D ? 4 : 2;
        buffer = buffer.substring(sepIdx + consumeLen);

        // 逐行解析事件块
        const lines = rawEvent.split(/\r?\n/);
        let upstreamEventType = '';
        let data = '';
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (line.length === 0) continue;
          if (line.startsWith('event:')) {
            upstreamEventType = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            let payload = line.substring(5);
            if (payload.length > 0 && payload.charCodeAt(0) === 0x20) {
              payload = payload.substring(1);
            }
            if (data.length > 0) data += '\n';
            data += payload;
          }
        }

        // 交给供应商 parser 解析
        const parsed = provider.streamParser('data:' + data);
        if (parsed && parsed.done) {
          break;
        }
        if (parsed && parsed.token && parsed.token.length > 0) {
          sse(res, 'token', parsed.token);
        }

        sepIdx = findEventBoundary(buffer);
      }
    }

    // 处理 buffer 里最后一个事件块（可能不以 \n\n 结尾）
    if (buffer.trim().length > 0) {
      const parsed = provider.streamParser('data:' + buffer.trim());
      if (parsed && parsed.token && parsed.token.length > 0) {
        sse(res, 'token', parsed.token);
      }
    }

    sse(res, 'message_end', '');
    res.end();
  } catch (err) {
    sse(res, 'error', {
      code: 'model_error',
      message: err ? err.message || String(err) : 'unknown error',
    });
    res.end();
  }
};

function findEventBoundary(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1) return lf;
  if (lf === -1) return crlf;
  return crlf < lf ? crlf : lf;
}
