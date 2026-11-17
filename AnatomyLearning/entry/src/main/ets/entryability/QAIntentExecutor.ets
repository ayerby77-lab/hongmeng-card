import { insightIntent, InsightIntentExecutor } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ArkAFIntent } from '../model/ArkAFIntent';

const TAG: string = 'AnatomyLearning.QAIntentExecutor';

/**
 * 课程知识问答意图执行器（insight_intent.json 注册的 AskCourseQuestion 对应的 srcEntry）。
 *
 * ArkAF 把意图匹配到前台 UIAbility 时调用 onExecuteInUIAbilityForeground。
 * 职责：
 *   1) 抽取 question 字符串（必填）；
 *   2) 填入 AppStorage 一次性通道（与 Want 冷/热启动走同一个 ArkAFIntent.publishQuestion）；
 *   3) 返回 insightIntent.ExecuteResult（必须是 Promise.resolve）。
 *
 * 设计说明：
 *   - 本类只做「意图 → AppStorage」桥接，不负责页面跳转或自动提交。
 *   - 页面端（EntryAbility.onCreate / onNewWant、KnowledgeQA @Watch）通过同一条通道接收，
 *     保证调试入口、QAIntentExecutor、Want 冷/热启动三条路径行为一致。
 */
export default class QAIntentExecutor extends InsightIntentExecutor {
  onExecuteInUIAbilityForeground(
    intentName: string,
    intentParams: Record<string, Object>
  ): Promise<insightIntent.ExecuteResult> {
    const raw = intentParams['question'];
    if (typeof raw !== 'string') {
      const failure: insightIntent.ExecuteResult = {
        code: -1,
        result: { message: '缺少 question 参数' }
      };
      return Promise.resolve(failure);
    }
    const question: string = raw.trim();
    if (question.length === 0) {
      const failure: insightIntent.ExecuteResult = {
        code: -1,
        result: { message: 'question 为空' }
      };
      return Promise.resolve(failure);
    }
    const rawId = intentParams['requestId'];
    const requestId = typeof rawId === 'string' ? rawId : undefined;
    ArkAFIntent.publishQuestion(question, true, requestId);
    hilog.info(0x0000, TAG, 'Intent question published: %{public}s', question);
    const result: insightIntent.ExecuteResult = {
      code: 0,
      result: { message: '已唤起课程知识问答' }
    };
    return Promise.resolve(result);
  }
}
