import { util } from '@kit.ArkTS';
import { Message, validateInput } from '../model/Message';
import { MessageStore } from '../store/MessageStore';

interface BridgeResult {
  ok: boolean;
  error: string;
}

// Only submitMessage and showToast are exposed through javaScriptProxy.
export class MessageBridge {
  private store?: MessageStore;
  private messages: Message[] = [];
  private ready: boolean = false;
  private changed: (messages: Message[]) => void = () => {};
  private toast: (text: string) => void = () => {};

  initialize(filesDir: string, changed: (messages: Message[]) => void, toast: (text: string) => void): void {
    this.ready = false;
    this.store = new MessageStore(filesDir);
    this.changed = changed;
    this.toast = toast;
    this.messages = this.store.load();
    this.ready = true;
  }

  snapshot(): Message[] { return this.messages.slice(); }
  close(): void { this.ready = false; }

  submitMessage(name: string, content: string): string {
    let error = validateInput(name, content);
    if (!this.ready || !this.store) error = '本地存储尚未就绪，请重新打开页面';
    if (!error && this.messages.length >= 500) error = '已达到 500 条留言上限';
    if (error) return this.result(false, error);
    try {
      const message: Message = {
        id: util.generateRandomUUID(true), name: name.trim(), content: content.trim(), createdAt: Date.now()
      };
      const next = [message].concat(this.messages);
      this.store!.save(next);
      this.messages = next;
    } catch (e) {
      return this.result(false, '保存失败，请检查存储空间后重试');
    }
    // Rendering or toast failures must never misreport a committed write as failed.
    try { this.changed(this.snapshot()); } catch (e) {}
    this.showToast('留言已保存到本机');
    return this.result(true, '');
  }

  showToast(text: string): void {
    if (this.ready && typeof text === 'string' && text.trim() && text.length <= 100) {
      try { this.toast(text); } catch (e) {}
    }
  }

  private result(ok: boolean, error: string): string {
    const result: BridgeResult = { ok, error };
    return JSON.stringify(result);
  }
}
