import { create } from 'zustand';
import {
  AdvisorClient,
  type BotBrain,
  type BotLevel,
  type Card,
  type EngineEvent,
  type GameView,
  type Shape,
  type WildAssignment,
} from '@guandan/core';
import type { GameDriver } from './driver/types';

/** 多义解释待选择项（id = 在 interpret() 完整列表中的下标，服务器按此复验） */
export interface InterpChoice {
  id: number;
  shape: Shape;
  wilds: WildAssignment[];
}

/** 回放的一帧：某时刻的视图 + 触发它的引擎事件 */
export interface ReplayFrame {
  view: GameView;
  events: EngineEvent[];
}

interface GameStore {
  driver: GameDriver | null;
  view: GameView | null;
  /** 最近一次事件（UI 动画/提示用） */
  lastEvents: EngineEvent[];
  selected: Card[];
  sortMode: 'rank' | 'count';
  toast: string | null;
  /** 多义解释待选择（逢人配歧义时弹窗） */
  pendingInterp: { cards: Card[]; choices: InterpChoice[] } | null;
  /** 单机配置（重开一局用） */
  localBotLevels: string[];
  /** 单机机器人是否由本地 Qwen 辅助选牌 */
  localUseLlm: boolean;
  localLlmUrl: string;
  localLlmModel: string;
  /** 牌局回放录像（帧序列） */
  recording: ReplayFrame[];
  /** 联机：当前是否已连接 */
  onlineConnected: boolean;
  /** 房间聊天记录 */
  chatMessages: { seat: number; name: string; text: string }[];

  bind(driver: GameDriver): void;
  unbind(): void;
  pushView(view: GameView, events: EngineEvent[]): void;
  clearRecording(): void;
  setRecording(frames: ReplayFrame[]): void;
  setOnlineConnected(c: boolean): void;
  appendChat(msg: { seat: number; name: string; text: string }): void;
  clearChat(): void;
  toggleCard(card: Card): void;
  setSelected(cards: Card[]): void;
  clearSelect(): void;
  setToast(msg: string | null): void;
  setPendingInterp(p: { cards: Card[]; choices: InterpChoice[] } | null): void;
  toggleSort(): void;
  setLocalBots(levels: string[]): void;
  setLocalLlm(useLlm: boolean, url: string, model: string): void;
}

export const useGame = create<GameStore>((set, get) => ({
  driver: null,
  view: null,
  lastEvents: [],
  selected: [],
  sortMode: 'rank',
  toast: null,
  pendingInterp: null,
  localBotLevels: ['normal', 'normal', 'normal'],
  localUseLlm: false,
  localLlmUrl: 'http://localhost:11434/v1',
  localLlmModel: 'qwen2.5:7b',
  recording: [],
  onlineConnected: true,
  chatMessages: [],

  bind(driver) {
    get().unbind();
    const unsub = driver.subscribe((view, events) => {
      // 第一局发牌 = 新一场比赛开始，重置录像（联机与单机统一在此收口）
      const freshMatch = events.some((e) => e.t === 'dealt') && view.handNo === 1;
      let rec = freshMatch ? [] : get().recording;
      // 仅记录有实际事件的帧；视图对象为引擎快照，不会被原地改写
      if (events.length > 0) rec = [...rec, { view, events }];
      set({ driver, view, lastEvents: events, selected: [], recording: rec });
    });
    void unsub;
    // 订阅由 driver 持有；driver.dispose 时清理。这里仅保存引用。
    set({ driver, view: driver.getView(), lastEvents: [], selected: [] });
  },
  unbind() {
    const d = get().driver;
    if (d) d.dispose();
    set({
      driver: null,
      view: null,
      lastEvents: [],
      selected: [],
      pendingInterp: null,
      onlineConnected: true,
      chatMessages: [],
    });
  },
  pushView(view, events) {
    set({ view, lastEvents: events });
  },
  clearRecording() {
    set({ recording: [] });
  },
  setRecording(frames) {
    set({ recording: frames });
  },
  setOnlineConnected(c) {
    set({ onlineConnected: c });
  },
  appendChat(msg) {
    set({ chatMessages: [...get().chatMessages.slice(-99), msg] });
  },
  clearChat() {
    set({ chatMessages: [] });
  },
  toggleCard(card) {
    const sel = get().selected;
    set({ selected: sel.includes(card) ? sel.filter((c) => c !== card) : [...sel, card] });
  },
  setSelected(cards) {
    set({ selected: cards });
  },
  clearSelect() {
    set({ selected: [] });
  },
  setToast(msg) {
    set({ toast: msg });
  },
  setPendingInterp(p) {
    set({ pendingInterp: p });
  },
  toggleSort() {
    set({ sortMode: get().sortMode === 'rank' ? 'count' : 'rank' });
  },
  setLocalBots(levels) {
    set({ localBotLevels: levels });
  },
  setLocalLlm(useLlm, url, model) {
    set({ localUseLlm: useLlm, localLlmUrl: url, localLlmModel: model });
  },
}));

/** 由单机配置构造 3 个机器人大脑（共用同一个 LLM 顾问实例） */
export function buildLocalBrains(
  levels: string[],
  useLlm: boolean,
  url: string,
  model: string,
): BotBrain[] {
  const advisor = useLlm ? new AdvisorClient({ baseUrl: url, model, timeoutMs: 8000 }) : undefined;
  return levels.map((l) => ({ level: l as BotLevel, advisor }));
}
