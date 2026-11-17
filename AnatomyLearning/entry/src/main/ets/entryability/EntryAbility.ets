import { UIAbility, Want, AbilityConstant, common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { KnowledgeSeeder } from '../data/KnowledgeSeeder';
import { ArkAFIntent } from '../model/ArkAFIntent';

const TAG: string = 'AnatomyLearning.Entry';

/**
 * 冷启动 / 热启动统一入口：
 *   - 冷启动：onCreate 解析 Want → publishQuestion；onWindowStageCreate 分支 loadContent
 *   - 热启动：onNewWant 解析 Want → publishQuestion，页面（Index / KnowledgeQA）各自 @StorageProp 通知
 *   - 知识库初始化失败：保留待处理问题，让页面有机会重试
 */
export default class EntryAbility extends UIAbility {

  // ---------- 生命周期（签名必须精确，否则 UIAbility 不会回调） ----------

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // 1) 冷启动解析 Want，有问题即写入一次性通道（KnowledgeQA.aboutToAppear 或 Index @Watch 消费）
    this.dispatchWant(want);

    // 2) 种子：幂等，仅首次导入 data/SeedDocuments.ts 的 12 篇资料
    this.bootstrapKnowledge();
  }

  /** Ability 已在后台，系统再带 Want 唤起 —— 热启动走 onNewWant，不走 onCreate。 */
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.dispatchWant(want);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 冷启动时决定直接打开 KnowledgeQA 还是先到首页；
    // 热启动下页面已存在，这里不会被再次调用。
    const pending: boolean = ArkAFIntent.hasPending();
    const target: string = pending ? 'pages/KnowledgeQA' : 'pages/Index';
    windowStage.loadContent(target, (error) => {
      if (error.code) {
        hilog.error(0x0000, TAG, 'Page load failed: %{public}s', error.message);
      } else {
        hilog.info(0x0000, TAG, 'Loaded page: %{public}s', target);
      }
    });
  }

  onDestroy(): void {
    // 进程级释放（不停 KnowledgeRuntime；让它下次 init 重新走一遍）
    hilog.info(0x0000, TAG, 'EntryAbility.onDestroy');
  }

  // ---------- 内部 ----------

  /**
   * 统一分发：冷/热启动都走这里。
   * 空问题直接忽略；有 requestId 的 Want 把它带给 publishQuestion 供 QA 去重。
   */
  private dispatchWant(want: Want): void {
    const question: string | undefined = ArkAFIntent.extractQuestionFromWant(want);
    if (question === undefined) {
      return;
    }
    const autoSubmit: boolean = ArkAFIntent.extractAutoSubmit(want);
    const requestId: string | undefined = ArkAFIntent.extractRequestId(want);
    ArkAFIntent.publishQuestion(question, autoSubmit, requestId);
    hilog.info(0x0000, TAG,
      'Published intent question: id=%{public}s auto=%{public}s',
      requestId ?? '(auto)', String(autoSubmit));
  }

  /** 幂等种子；初始化失败不阻塞后续 onWindowStageCreate（让页面有机会重试）。 */
  private bootstrapKnowledge(): void {
    const self: EntryAbility = this;
    const task: () => Promise<void> = async (): Promise<void> => {
      let seederError: Error | null = null;
      try {
        const seeder: KnowledgeSeeder = new KnowledgeSeeder(self.context);
        const count: number = await seeder.seedIfNeeded();
        if (count > 0) {
          hilog.info(0x0000, TAG, 'Seeded %{public}d knowledge documents.', count);
        }
      } catch (err) {
        // ArkTS 规则：catch 子句不得写类型注解（arkts-no-types-in-catch），
        // 也禁止隐式 any / unknown（arkts-no-any-unknown），因此在块内显式收窄到 Error。
        if (err instanceof Error) {
          seederError = err;
        } else {
          seederError = new Error(String(err));
        }
      }
      if (seederError !== null) {
        hilog.error(0x0000, TAG, 'Seed failed: %{public}s', seederError.message);
      }
    };
    void task();
  }
}
