import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    try {
      windowStage.loadContent('pages/Index', (error) => {
        if (error.code) {
          hilog.error(0x0000, 'CardFolio', 'Page load failed: %{public}s', error.message);
        }
      });
    } catch (error) {
      hilog.error(0x0000, 'CardFolio', 'Unable to initialize main page');
    }
  }
}
