import type {
  Action,
  BotLevel,
  EngineEvent,
  GameView,
  RoomStateMsg,
  ServerMsg,
} from '@guandan/core';
import type { GameDriver } from './types';

/** 服务器 WebSocket 地址：开发模式连 3000 端口，生产同源 */
export function wsUrl(): string {
  const saved = localStorage.getItem('guandan_ws');
  if (saved) return saved;
  if (location.port === '5173' || location.port === '5174') {
    return `ws://${location.hostname}:3000`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/** 空视图占位（连接建立/游戏未开始时） */
function idleView(you: number): GameView {
  return {
    you: you as GameView['you'],
    phase: 'idle',
    rules: { allowBareSteel: true, allowJokerPair: true, allowJokerAttachment: false, levelPolicy: 'higher', passA: 'any', revealTribute: true, levelUps: { doubleDown: 3, oneThree: 2, oneFour: 1 } },
    handNo: 0,
    level: 2,
    levels: [2, 2],
    hand: [],
    handCounts: [0, 0, 0, 0],
    turn: 0,
    leader: 0,
    last: null,
    trickPlays: [],
    placements: [],
    prevPlacements: null,
    tribute: null,
    stream: [],
    winner: null,
  };
}

/** 联机模式驱动：包装 WebSocket，收 gameSnapshot/gameEvents 喂给订阅者 */
export class OnlineDriver implements GameDriver {
  readonly mode = 'online' as const;
  private ws: WebSocket | null = null;
  private token = localStorage.getItem('guandan_token') ?? '';
  private name: string;
  /** 我的座位（youAre 消息确定；-1 = 尚未入座） */
  mySeat = -1;
  private view: GameView = idleView(0);
  private events: EngineEvent[] = [];
  private listeners = new Set<(view: GameView, events: EngineEvent[]) => void>();
  /** 房间状态回调（RoomPage 用） */
  onRoomState?: (rs: RoomStateMsg) => void;
  onKicked?: (reason: string) => void;
  onYouAre?: (seat: number, roomId: string | null) => void;
  /** 连接状态回调（断线重连 UI 用） */
  onConnection?: (connected: boolean) => void;
  /** 收到聊天消息回调 */
  onChat?: (msg: { seat: number; name: string; text: string }) => void;
  roomId: string | null = null;
  roomState: RoomStateMsg | null = null;
  connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;

  constructor(name = '玩家') {
    this.name = name;
  }

  connect(): void {
    if (this.disposed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return; // 已在连
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.onConnection?.(true);
      if (!this.token) {
        this.token = crypto.randomUUID();
        localStorage.setItem('guandan_token', this.token);
      }
      this.send('hello', { token: this.token, name: this.name });
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onclose = () => {
      this.connected = false;
      this.onConnection?.(false);
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 会随后触发，统一处理 */
    };
  }

  /** 断线后指数退避重连（带 token 自动归位回原房间/座位） */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(1200 * Math.pow(1.7, this.reconnectAttempt), 8000) + Math.random() * 600;
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      this.connect();
    }, delay);
  }

  private send(type: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ v: 1, type, payload }));
    }
  }

  private handle(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'youAre':
        this.mySeat = msg.payload.seat;
        if (msg.payload.token) {
          this.token = msg.payload.token;
          localStorage.setItem('guandan_token', this.token);
        }
        this.roomId = msg.payload.roomId;
        this.view = idleView(Math.max(0, this.mySeat));
        this.onYouAre?.(msg.payload.seat, msg.payload.roomId);
        this.emit();
        return;
      case 'roomState':
        this.roomState = msg.payload;
        this.roomId = msg.payload.roomId;
        this.onRoomState?.(msg.payload);
        return;
      case 'gameSnapshot':
      case 'gameEvents':
        this.view = msg.payload.view;
        if (msg.type === 'gameEvents') this.events = msg.payload.events;
        this.emit();
        return;
      case 'kicked':
        this.disposed = true;
        this.clearReconnect();
        this.onKicked?.(msg.payload.reason);
        return;
      case 'chatMsg':
        this.onChat?.(msg.payload);
        return;
      case 'error':
        console.warn('服务器错误:', msg.payload.code, msg.payload.message);
        this.onError?.(msg.payload);
        return;
    }
  }

  /** 停止重连（被踢/主动离开时） */
  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** UI 可注册错误提示（toast） */
  onError?: (e: { code: string; message: string }) => void;

  // ————— 房间操作 —————
  createRoom(): void {
    this.send('createRoom', {});
  }
  joinRoom(roomId: string, spectate = false): void {
    this.send('joinRoom', { roomId: roomId.toUpperCase(), spectate });
  }
  sendChat(text: string): void {
    this.send('chat', { text });
  }
  /** 观战视角：seat 0..3 看该座位手牌，-1 隐藏手牌 */
  setSpectateSeat(seat: number): void {
    this.send('spectateSeat', { seat });
  }
  addBot(seat: number, level: BotLevel, llm = false): void {
    this.send('addBot', { seat, level, llm });
  }
  removeBot(seat: number): void {
    this.send('removeBot', { seat });
  }
  setReady(ready: boolean): void {
    this.send('setReady', { ready });
  }
  startGame(): void {
    this.send('startGame', {});
  }
  leaveRoom(): void {
    this.send('leaveRoom', {});
    this.roomId = null;
    this.roomState = null;
    this.view = idleView(this.mySeat);
    this.emit();
  }
  /** 退出当前对局回大厅（UI 退出键调用，dispose 前通知服务器） */
  leave(): void {
    this.send('leaveRoom', {});
  }

  // ————— GameDriver —————

  dispatch(a: Action): void {
    switch (a.t) {
      case 'play':
        this.send('play', { cards: a.cards, interpId: a.interpId });
        return;
      case 'pass':
        this.send('pass', {});
        return;
      case 'tribute':
        this.send('tribute', { card: a.card });
        return;
      case 'returnTribute':
        this.send('returnTribute', { card: a.card });
        return;
      case 'deal':
        return; // 联机模式由服务器自动调度下一局
    }
  }

  subscribe(fn: (view: GameView, events: EngineEvent[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.getView(), []);
    return () => this.listeners.delete(fn);
  }

  getView(): GameView {
    return this.view;
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.view, this.events);
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnect();
    this.listeners.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
