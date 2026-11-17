// 人体浏览模块 · 浏览历史写入调度（统一记录入口）。
//
// 所有最终产生「结构选中」的路径——模型点选、原生搜索定位、收藏/历史定位——
// 都汇聚到会话层的 `onStructureSelected` 事件；页面用本调度器统一写库，
// 避免各路径各自调用存储层。
//
// 负责：
//   - 高频点选：同一结构在最小间隔内连续重复时跳过写库（避免重复行与写放大）；
//   - 异步失败：写库异常经 onError 上报，且不阻断后续记录（串行链继续）；
//   - 页面退出：dispose() 后不再记录，也不再上报在途结果。
import { SelectedStructure } from '../model/Anatomy';

// 历史写入端口：生产环境由 AnatomyStore 实现，测试可注入假实现。
export interface HistorySink {
  addHistory(id: string, name: string, systemId: string): Promise<boolean>;
}

// 写入失败回调：selection 为失败的结构快照，message 为可读原因。
export type HistoryErrorListener = (selection: SelectedStructure, message: string) => void;

// 同一结构重复点选的最小写库间隔；间隔内的连续重复视为一次浏览。
const DEFAULT_MIN_INTERVAL_MS: number = 800;

export class HistoryRecorder {
  private sink: HistorySink;
  private minIntervalMs: number;
  private disposed: boolean = false;
  private chain: Promise<void> = Promise.resolve();
  private lastId: string = '';
  private lastRecordedAt: number = 0;
  private errorListener: HistoryErrorListener | null = null;

  constructor(sink: HistorySink, minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS) {
    this.sink = sink;
    this.minIntervalMs = minIntervalMs;
  }

  setOnError(listener: HistoryErrorListener): void {
    this.errorListener = listener;
  }

  // 统一记录入口：结构选中后调用一次。
  record(selection: SelectedStructure): void {
    if (this.disposed) {
      return;
    }
    const id: string = selection.id.trim();
    const name: string = selection.name.trim();
    if (id.length === 0 || name.length === 0) {
      return;
    }
    const now: number = Date.now();
    // 同一结构在最小间隔内连续重复点选：跳过，避免重复记录与写放大。
    if (id === this.lastId && now - this.lastRecordedAt < this.minIntervalMs) {
      return;
    }
    this.lastId = id;
    this.lastRecordedAt = now;
    this.enqueue({ id: id, name: name, systemId: selection.systemId });
  }

  // 页面退出：停止记录并忽略在途结果。
  dispose(): void {
    this.disposed = true;
    this.errorListener = null;
  }

  // 串行执行写库：保证 visitedAt 递增顺序与点选顺序一致，且不产生并发事务。
  private enqueue(row: SelectedStructure): void {
    this.chain = this.chain.then((): Promise<boolean> => {
      return this.sink.addHistory(row.id, row.name, row.systemId);
    }).then((ok: boolean): void => {
    }, (error: Object): void => {
      if (!this.disposed && this.errorListener !== null) {
        this.errorListener(row, HistoryRecorder.describe(error));
      }
    });
  }

  private static describe(error: Object): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return '浏览历史写入失败';
  }
}
