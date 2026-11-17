// 进程内唯一的服务装配与生命周期所有者（接口约定 §7）。
//
// 职责：
//   init(context)  —— 懒初始化，幂等；并发调用共享同一 Promise，绝不重复建实例。
//   shared()       —— 取进程单例；未初始化抛 ServiceException(INDEX_NOT_READY)。
//   acquirePage()  —— 页面引用计数；页面持有期间订阅索引状态。
//   onIndexStatus()—— 索引状态订阅，返回退订函数。
//   shutdown()     —— 进程级释放：bridge.stop() 退订变更、清理向量索引。

import { common } from '@kit.AbilityKit';
import { ServiceContainer, ServiceContainerOptions } from '../service/ServiceContainer';
import { KnowledgeService } from '../service/KnowledgeService';
import { KnowledgeIndexBridge } from '../service/KnowledgeIndexBridge';
import { ServiceException, ServiceError } from '../service/types';
import { CLOUD_FUNCTION_URL, CLOUD_MODEL } from './CloudConfig';

export interface IndexStatus {
  ready: boolean;
  indexedCount: number;
  pendingCount: number;
}

export interface KnowledgeRuntimeOptions {
  useCloud?: boolean;
  cloudFunctionUrl?: string;
  model?: string;
}

// 注意：ArkTS 严格模式禁止用对象字面量实现「方法语法」声明的接口成员，
// 因此这里用函数类型属性（与 types.ets 的 ChatHandle.cancel 一致），
// 调用方写法不变：lease.release()。
export interface PageLease {
  release: () => void;
}

type StatusCallback = (status: IndexStatus) => void;

const POLL_INTERVAL_MS = 400;

export class KnowledgeRuntime {
  private static instance: KnowledgeRuntime | null = null;
  private static starting: Promise<KnowledgeRuntime> | null = null;

  readonly container: ServiceContainer;
  readonly knowledge: KnowledgeService;
  readonly bridge: KnowledgeIndexBridge;
  /** 是否走云端（来自 CloudConfig 或显式 opts）。页面据此决定是否需要网络预检。 */
  readonly useCloud: boolean;

  private callbacks: StatusCallback[] = [];
  private pageCount: number = 0;
  private pollTimer: number = -1;
  private lastReady: boolean = false;
  private lastIndexed: number = -1;
  private lastPending: number = -1;

  private constructor(
    container: ServiceContainer,
    knowledge: KnowledgeService,
    bridge: KnowledgeIndexBridge,
    useCloud: boolean
  ) {
    this.container = container;
    this.knowledge = knowledge;
    this.bridge = bridge;
    this.useCloud = useCloud;
  }

  /** 幂等初始化；并发调用返回同一 Promise。 */
  static init(context: common.Context, opts?: KnowledgeRuntimeOptions): Promise<KnowledgeRuntime> {
    const existing: KnowledgeRuntime | null = KnowledgeRuntime.instance;
    if (existing !== null) {
      return new Promise<KnowledgeRuntime>((resolve: (v: KnowledgeRuntime) => void): void => {
        resolve(existing);
      });
    }
    const pending: Promise<KnowledgeRuntime> | null = KnowledgeRuntime.starting;
    if (pending !== null) {
      return pending;
    }
    const task: Promise<KnowledgeRuntime> = KnowledgeRuntime.bootstrap(context, opts);
    KnowledgeRuntime.starting = task;
    // 失败时清空 starting，允许下一次重试（幂等只针对成功路径）。
    task.catch((): void => {
      KnowledgeRuntime.starting = null;
    });
    return task;
  }

  /** 进程单例；未初始化抛 INDEX_NOT_READY。 */
  static shared(): KnowledgeRuntime {
    const inst: KnowledgeRuntime | null = KnowledgeRuntime.instance;
    if (inst === null) {
      throw new ServiceException(
        ServiceError.INDEX_NOT_READY,
        'KnowledgeRuntime 尚未初始化，请先 await KnowledgeRuntime.init(context)'
      );
    }
    return inst;
  }

  private static async bootstrap(
    context: common.Context,
    opts?: KnowledgeRuntimeOptions
  ): Promise<KnowledgeRuntime> {
    // 1) 资料库就绪（建 anatomy_knowledge.db）
    const knowledge: KnowledgeService = KnowledgeService.getInstance(context);
    await knowledge.ensureReady();

    // 2) 服务容器（云端 or 离线替身）
    const url: string = opts?.cloudFunctionUrl ?? CLOUD_FUNCTION_URL;
    const useCloud: boolean = opts?.useCloud ?? (url.length > 0);
    const containerOpts: ServiceContainerOptions = {
      useCloud: useCloud,
      cloudFunctionUrl: url,
      model: opts?.model ?? CLOUD_MODEL,
    };
    const container: ServiceContainer = new ServiceContainer(containerOpts);

    // 3) 接真实知识库：全量同步当前 revision 片段 + 订阅增量变更
    const bridge: KnowledgeIndexBridge = await container.connectKnowledgeService(knowledge);

    const runtime: KnowledgeRuntime = new KnowledgeRuntime(container, knowledge, bridge, useCloud);
    KnowledgeRuntime.instance = runtime;
    return runtime;
  }

  /** 当前索引状态快照。 */
  indexStatus(): IndexStatus {
    const retrieval = this.container.retrieval;
    const status: IndexStatus = {
      ready: retrieval.indexReady,
      indexedCount: retrieval.indexedCount,
      pendingCount: this.container.indexManager.pendingCount,
    };
    return status;
  }

  /** 订阅索引状态；立即回调一次当前值，返回退订函数。 */
  onIndexStatus(cb: StatusCallback): () => void {
    this.callbacks.push(cb);
    cb(this.indexStatus());
    this.startPolling();
    const unsubscribe = (): void => {
      const i: number = this.callbacks.indexOf(cb);
      if (i !== -1) {
        this.callbacks.splice(i, 1);
      }
      if (this.callbacks.length === 0 && this.pageCount <= 0) {
        this.stopPolling();
      }
    };
    return unsubscribe;
  }

  /** 页面租约：引用计数 +1；release() 时 -1。页面不得自行停 bridge。 */
  acquirePage(): PageLease {
    this.pageCount = this.pageCount + 1;
    this.startPolling();
    const lease: PageLease = {
      release: (): void => {
        this.pageCount = this.pageCount - 1;
        if (this.pageCount <= 0 && this.callbacks.length === 0) {
          this.stopPolling();
        }
      },
    };
    return lease;
  }

  /** 进程级释放（仅 EntryAbility.onDestroy 或显式调用）。 */
  async shutdown(): Promise<void> {
    this.bridge.stop();
    this.stopPolling();
    this.callbacks = [];
    this.pageCount = 0;
    KnowledgeRuntime.instance = null;
    KnowledgeRuntime.starting = null;
  }

  // --- 内部：索引状态轮询（不侵入 Agent D 的 IndexSyncManager） ---
  private startPolling(): void {
    if (this.pollTimer !== -1) {
      return;
    }
    this.pollTimer = setInterval((): void => {
      this.tick();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer === -1) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = -1;
  }

  private tick(): void {
    const s: IndexStatus = this.indexStatus();
    if (s.ready === this.lastReady && s.indexedCount === this.lastIndexed
      && s.pendingCount === this.lastPending) {
      return;
    }
    this.lastReady = s.ready;
    this.lastIndexed = s.indexedCount;
    this.lastPending = s.pendingCount;
    for (let i = 0; i < this.callbacks.length; i++) {
      this.callbacks[i](s);
    }
  }
}
