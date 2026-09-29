import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { MessageBridge } from '../bridge/MessageBridge';
import { Message, pageCall } from '../model/Message';

@Entry
@Component
struct MessageBoard {
  @State private title: string = '网页留言板';
  @State private loading: boolean = true;
  @State private progress: number = 0;
  @State private error: string = '';
  @State private ready: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: MessageBridge = new MessageBridge();
  private active: boolean = true;
  private timer: number = -1;

  aboutToAppear(): void { this.active = true; this.initialize(); }
  aboutToDisappear(): void {
    this.active = false;
    this.bridge.close();
    clearTimeout(this.timer);
  }

  private initialize(): void {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.bridge.initialize(context.filesDir, (messages: Message[]) => {
        this.send('renderMessages', messages);
      }, (text: string) => this.getUIContext().getPromptAction().showToast({ message: text }));
    } catch (e) { this.fail('本地留言读取失败，原文件已保留。请检查存储后重试。'); }
  }

  private fail(text: string): void {
    clearTimeout(this.timer);
    this.loading = false;
    this.ready = false;
    this.error = text;
  }

  private send(method: string, value: Message[] | string): void {
    if (!this.active || this.error) return;
    try {
      this.controller.runJavaScript(pageCall(method, value)).catch(() => {
        if (this.active) this.fail('网页通信失败；已保存的留言仍在本机，请刷新重试。');
      });
    } catch (e) { this.fail('网页尚未就绪，请刷新重试。'); }
  }

  private reload(): void {
    this.error = '';
    this.ready = false;
    this.loading = true;
    this.initialize();
    if (!this.error) {
      try { this.controller.refresh(); } catch (e) { this.fail('刷新失败，请返回后重新打开。'); }
    }
  }

  build() {
    Column() {
      Row({ space: 10 }) {
        Text(this.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#214E45').layoutWeight(1)
        Button('返回').onClick(() => this.getUIContext().getRouter().back())
      }.padding(18).width('100%')
      Row({ space: 12 }) {
        Button('刷新').onClick(() => this.reload())
        Button('推送原生通知').enabled(this.ready && !this.error)
          .onClick(() => this.send('notify', '原生通知：愿每一次相遇，都留下温暖的回声。'))
      }.padding({ bottom: 12 })
      if (this.loading) {
        Progress({ value: this.progress, total: 100, type: ProgressType.Linear }).width('100%')
        Text('正在加载本地留言板…').fontSize(13).padding(8)
      }
      if (this.error) {
        Text(this.error).fontColor('#A83B31').padding(16)
        Button('重试').onClick(() => this.reload())
      }
      Web({ src: $rawfile('message-board.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(false)
        .javaScriptProxy({ object: this.bridge, name: 'NativeBoard', methodList: ['submitMessage', 'showToast'], controller: this.controller })
        .onLoadIntercept((event) => {
          return event ? event.data.getRequestUrl() !== 'resource://rawfile/message-board.html' : true;
        })
        .onPageBegin(() => {
          this.ready = false;
          if (!this.error) {
            this.loading = true;
            this.progress = 0;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.fail('加载超时，请重试。'), 15000);
          }
        })
        .onProgressChange((event) => { if (event) this.progress = event.newProgress; })
        .onTitleReceive((event) => { if (event) this.title = event.title.substring(0, 30) || '网页留言板'; })
        .onPageEnd(() => {
          clearTimeout(this.timer);
          this.loading = false;
          if (!this.error) { this.ready = true; this.send('renderMessages', this.bridge.snapshot()); }
        })
        .onErrorReceive((event) => {
          if (event && event.request.isMainFrame()) this.fail('本地网页加载失败，请重试。');
        })
        .onHttpErrorReceive((event) => {
          if (event && event.request.isMainFrame()) this.fail('网页响应异常，请重试。');
        })
        .visibility(this.error ? Visibility.Hidden : Visibility.Visible)
        .width('100%').layoutWeight(1)
    }.width('100%').height('100%').backgroundColor('#F5F2EB')
  }
}
