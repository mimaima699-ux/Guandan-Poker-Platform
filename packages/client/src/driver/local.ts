import {
  DEFAULT_RULES,
  actorSeat,
  applyAction,
  botActionWithBrain,
  createInitialMatch,
  mulberry32,
  viewOf,
  type Action,
  type BotBrain,
  type EngineEvent,
  type GameState,
  type GameView,
  type Rng,
} from '@guandan/core';
import type { GameDriver } from './types';

/** 把「3 个机器人」的大脑对齐到座位下标（0 号位是人类，占位）；不足补普通，越界兜底 */
export function seatBrains(brains: BotBrain[]): BotBrain[] {
  const out: BotBrain[] = [{ level: 'normal' }];
  for (let i = 0; i < 3; i++) out.push(brains[i] ?? { level: 'normal' });
  return out;
}

/** 单机模式：引擎跑在浏览器里，三个机器人经 setTimeout 调度，走与真人相同的动作入口 */
export class LocalDriver implements GameDriver {
  readonly mode = 'local' as const;
  private state: GameState;
  private rng: Rng;
  private brains: BotBrain[]; // 下标 = 座位（0=人，1/2/3=机器人）
  private listeners = new Set<(view: GameView, events: EngineEvent[]) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(brains: BotBrain[] = [{ level: 'normal' }, { level: 'normal' }, { level: 'normal' }], seed?: number) {
    this.brains = seatBrains(brains);
    this.state = createInitialMatch(DEFAULT_RULES);
    this.rng = mulberry32(seed ?? ((Math.random() * 0x7fffffff) | 0));
  }

  /** 开始第一局 */
  start(): void {
    this.act({ t: 'deal' });
  }

  dispatch(a: Action): void {
    // 人类固定坐 0 号位；deal 之外的座位动作一律拒绝
    if (a.t !== 'deal' && a.seat !== 0) return;
    this.act(a);
  }

  subscribe(fn: (view: GameView, events: EngineEvent[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.getView(), []);
    return () => this.listeners.delete(fn);
  }

  getView(): GameView {
    return viewOf(this.state, 0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.listeners.clear();
  }

  private act(a: Action): void {
    if (this.disposed) return;
    const res = applyAction(this.state, a, this.rng);
    if (!res.ok) {
      console.warn('动作被拒:', a.t, res.error);
      return;
    }
    this.state = res.state;
    this.emit(res.events);
    this.scheduleBots();
  }

  private emit(events: EngineEvent[]): void {
    const view = this.getView();
    for (const fn of this.listeners) fn(view, events);
  }

  /** 当前该行动的是机器人时，延迟执行（拟人节奏） */
  private scheduleBots(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.disposed || this.state.phase === 'idle' || this.state.phase === 'matchOver') return;
    // handOver 由人类点“下一局”推进；其余阶段若行动者非 0 号位则机器人接管
    if (this.state.phase === 'handOver') return;
    const seat = actorSeat(this.state);
    if (seat === 0) return;
    const delay = 420 + Math.random() * 480;
    this.timer = setTimeout(() => {
      void (async () => {
        if (this.disposed) return;
        const view = viewOf(this.state, seat);
        const action = await botActionWithBrain(view, this.brains[seat], this.rng);
        if (this.disposed) return;
        this.act(action);
      })();
    }, delay);
  }
}
