import type { BotLevel } from './ai/bot';
import type { Card } from './card';
import type { EngineEvent } from './engine/state';
import type { GameView } from './engine/view';

/** ————— 联机协议类型（信封：{v:1, type, payload}；zod 校验在 server 侧） ————— */

export interface RoomSeatInfo {
  seat: number;
  kind: 'human' | 'bot' | 'open';
  name: string;
  ready: boolean;
  connected: boolean;
  botLevel?: BotLevel;
  /** 该机器人是否由本地 LLM（Qwen）辅助选牌 */
  llm?: boolean;
}

export interface RoomStateMsg {
  roomId: string;
  /** lobby=房间准备中；playing=牌局进行（含局间） */
  phase: 'lobby' | 'playing';
  host: number;
  seats: RoomSeatInfo[];
  started: boolean;
  /** 观战人数 */
  spectators: number;
}

export type ClientMsg =
  | { type: 'hello'; payload: { token?: string; name?: string } }
  | { type: 'createRoom'; payload: { name?: string } }
  | { type: 'joinRoom'; payload: { roomId: string; name?: string; spectate?: boolean } }
  | { type: 'addBot'; payload: { seat: number; level?: BotLevel; llm?: boolean } }
  | { type: 'removeBot'; payload: { seat: number } }
  | { type: 'setReady'; payload: { ready: boolean } }
  | { type: 'startGame'; payload: Record<string, never> }
  | { type: 'tribute'; payload: { card: Card } }
  | { type: 'returnTribute'; payload: { card: Card } }
  | { type: 'play'; payload: { cards: Card[]; interpId: number } }
  | { type: 'pass'; payload: Record<string, never> }
  | { type: 'chat'; payload: { text: string } }
  | { type: 'spectateSeat'; payload: { seat: number } }
  | { type: 'leaveRoom'; payload: Record<string, never> };

export type ServerMsg =
  | { type: 'error'; payload: { code: string; message: string } }
  | { type: 'youAre'; payload: { seat: number; token: string; roomId: string | null } }
  | { type: 'roomState'; payload: RoomStateMsg }
  | {
      type: 'gameSnapshot';
      payload: { view: GameView; roomState: RoomStateMsg; seq: number };
    }
  | {
      type: 'gameEvents';
      payload: { view: GameView; events: EngineEvent[]; seq: number };
    }
  | { type: 'chatMsg'; payload: { seat: number; name: string; text: string } }
  | { type: 'kicked'; payload: { reason: string } };

export const PROTOCOL_VERSION = 1;
