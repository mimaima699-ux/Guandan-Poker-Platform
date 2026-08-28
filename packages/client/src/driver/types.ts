import type { Action, EngineEvent, GameView } from '@guandan/core';

/** 客户端与游戏引擎的唯一通道：单机与联机共用同一套 UI */
export interface GameDriver {
  readonly mode: 'local' | 'online';
  /** 人类玩家动作（出牌/过牌/进贡/还贡；单机模式下还有 deal） */
  dispatch(a: Action): void;
  /** 订阅视图更新，返回取消函数 */
  subscribe(fn: (view: GameView, events: EngineEvent[]) => void): () => void;
  getView(): GameView;
  /** 主动离开当前对局/房间（联机模式通知服务器；单机无操作）。dispose 前调用 */
  leave?(): void;
  dispose(): void;
}
