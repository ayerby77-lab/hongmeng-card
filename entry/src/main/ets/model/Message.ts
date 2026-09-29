export interface Message {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

export function validateInput(name: string, content: string): string {
  if (typeof name !== 'string' || typeof content !== 'string') return '留言参数格式错误';
  if (!name.trim() || name.length > 30) return '昵称须为 1–30 字';
  if (!content.trim() || content.length > 500) return '留言须为 1–500 字';
  return '';
}

export function validateMessages(messages: Message[]): void {
  if (!Array.isArray(messages) || messages.length > 500) throw new Error('留言文件格式错误');
  const ids: string[] = [];
  for (const message of messages) {
    if (!message || typeof message.id !== 'string' || !message.id ||
      typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt) || message.createdAt < 0 ||
      validateInput(message.name, message.content) || ids.indexOf(message.id) >= 0) {
      throw new Error('留言文件损坏，原文件已保留');
    }
    ids.push(message.id);
  }
}

export function pageCall(method: string, value: Message[] | string): string {
  if (method !== 'renderMessages' && method !== 'notify') throw new Error('未知网页方法');
  return 'window.MessageBoard.' + method + '(' + JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ');';
}
