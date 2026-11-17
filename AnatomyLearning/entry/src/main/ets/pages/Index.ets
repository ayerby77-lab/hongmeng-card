import { ArkAFIntent } from '../model/ArkAFIntent';

@Entry
@Component
struct Index {
  @State private navigationError: string = '';
  private pageVisible: boolean = false;
  private navigating: boolean = false;

  onPageShow(): void {
    this.pageVisible = true;
    this.onPendingChanged();
  }

  onPageHide(): void { this.pageVisible = false; }

  /**
   * 首页热启动通知：Ability 已在后台时，系统带 Want 唤起会触发 EntryAbility.onNewWant
   * → publishQuestion → AppStorage 变化 → 这里 @Watch 捕获，立即导航到问答页。
   * 冷启动由 EntryAbility.onWindowStageCreate 直接 loadContent('pages/KnowledgeQA')，
   * 不会经过首页，因此这里只处理「应用已在首页，后台唤起带问题」的情况。
   */
  @StorageProp(ArkAFIntent.PENDING_QUESTION_KEY)
  @Watch('onPendingChanged')
  private pendingFromStorage: string = '';

  private async openPage(page: string): Promise<void> {
    try {
      await this.getUIContext().getRouter().pushUrl({ url: `pages/${page}` });
      this.navigationError = '';
    } catch (error) {
      this.navigationError = '页面打开失败，请再次点击重试。';
    }
  }

  private openKnowledgeQA(question?: string): void {
    if (question && question.trim().length > 0) {
      ArkAFIntent.publishQuestion(question.trim(), true);
      return;
    }
    this.openPage('KnowledgeQA');
  }

  /** AppStorage 有问题 → 导航到 QA（QA 页面自己 consume 并自动提交）。 */
  private onPendingChanged(): void {
    if (!this.pageVisible || this.navigating || !ArkAFIntent.hasPending()) {
      return;
    }
    // 让 QA 页面消费它；Index 不 consume，避免把问题吞掉。
    this.navigating = true;
    this.openPage('KnowledgeQA').finally((): void => { this.navigating = false; });
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('人体解剖学习').fontSize(30).fontWeight(FontWeight.Bold)
        Text('课程项目 · 基础框架').fontSize(16).fontColor('#526170')
        Button('人体浏览').width('100%').onClick(() => this.openPage('AnatomyBrowser'))
        Button('结构详情').width('100%').onClick(() => this.openPage('StructureDetail'))
        Button('收藏夹').width('100%').onClick(() => this.openPage('Favorites'))
        Button('浏览历史').width('100%').onClick(() => this.openPage('History'))
        Button('课程知识问答').width('100%').onClick(() => this.openKnowledgeQA())
        Button('课程资料管理').width('100%').onClick(() => this.openPage('KnowledgeManage'))
        Button('关于').width('100%').onClick(() => this.openPage('About'))
        if (this.navigationError.length > 0) {
          Text(this.navigationError).fontColor('#B42318')
        }
        Text('各业务页面已预留入口，核心功能将在后续任务中实现。')
          .fontSize(14).fontColor('#526170')
      }.width('100%').padding(24)
    }.width('100%').height('100%').backgroundColor('#F5F7FA')
  }
}
