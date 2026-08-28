import type { WebSocket } from 'ws';
import {
  DEFAULT_RULES,
  AdvisorClient,
  applyAction,
  actorSeat,
  botActionWithBrain,
  createInitialMatch,
  mulberry32,
  viewOf,
  type Action,
  type AdvisorConfig,
  type BotBrain,
  type BotLevel,
  type EngineEvent,
  type GameState,
  type GameView,
  type RoomSeatInfo,
  type RoomStateMsg,
  type SeatId,
  type ServerMsg,
} from '@guandan/core';

const SEAT_IDS: SeatId[] = [0, 1, 2, 3];

interface SeatState {
  kind: 'human' | 'bot' | 'open';
  name: string;
  ready: boolean;
  connected: boolean;
  botLevel: BotLevel;
  /** 该机器人是否由本地 LLM 辅助选牌 */
  llm: boolean;
  token: string | null; // 人类玩家的重连令牌
}

export interface ClientConn {
  ws: WebSocket;
  room: Room | null;
  seat: SeatId | null;
  token: string;
  name: string;
  alive: boolean;
}

export interface RoomOptions {
  /** 机器人行动延迟区间（毫秒），测试可置 0 */
  botDelay?: [number, number];
  /** 局间自动开下一局延迟（毫秒） */
  nextHandDelay?: number;
  /** 本地 LLM（Qwen/Ollama）顾问配置；启用了 llm 的机器人座位会用它选牌 */
  advisor?: AdvisorConfig;
}

/** 一个联机房间：座位管理 + 服务器权威牌局 + AI 补位/托管 */
export class Room {
  readonly id: string;
  private seats: SeatState[];
  private hostSeat: SeatId = 0;
  private engine: GameState = createInitialMatch(DEFAULT_RULES);
  private rng = mulberry32((Math.random() * 0x7fffffff) | 0);
  private conns: (ClientConn | null)[] = [null, null, null, null];
  private spectators = new Set<ClientConn>();
  private spectatorSeats = new Map<ClientConn, SeatId>();
  private botTimers: (ReturnType<typeof setTimeout> | null)[] = [null, null, null, null];
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private started = false;
  private opts: { botDelay: [number, number]; nextHandDelay: number };
  private advisor: AdvisorClient | null;

  constructor(id: string, opts: RoomOptions = {}) {
    this.id = id;
    this.opts = {
      botDelay: opts.botDelay ?? [450, 1000],
      nextHandDelay: opts.nextHandDelay ?? 3500,
    };
    this.advisor = opts.advisor ? new AdvisorClient(opts.advisor) : null;
    this.seats = SEAT_IDS.map(() => ({
      kind: 'open',
      name: '',
      ready: false,
      connected: false,
      botLevel: 'normal',
      llm: false,
      token: null,
    }));
  }

  // ————— 座位管理 —————

  join(conn: ClientConn): SeatId | null {
    for (const seat of SEAT_IDS) {
      const s = this.seats[seat];
      if (s.kind === 'open' || (s.kind === 'human' && !this.conns[seat])) {
        s.kind = 'human';
        s.ready = false;
        s.connected = true;
        s.token = conn.token;
        s.name = conn.name;
        this.conns[seat] = conn;
        conn.room = this;
        conn.seat = seat;
        this.broadcastRoomState();
        return seat;
      }
    }
    return null;
  }

  rebindConn(seat: SeatId, conn: ClientConn): boolean {
    const s = this.seats[seat];
    if (s.kind !== 'human' || s.token !== conn.token) return false;
    this.conns[seat] = conn;
    s.connected = true;
    conn.room = this;
    conn.seat = seat;
    if (s.name === '' || conn.name) s.name = conn.name || s.name;
    this.broadcastRoomState();
    return true;
  }

  /** 以观战者身份加入（不占座，seat 保持 null） */
  joinSpectate(conn: ClientConn): void {
    conn.room = this;
    conn.seat = null;
    this.spectators.add(conn);
    this.broadcastRoomState();
    if (this.started) this.sendSpectatorView(conn);
  }

  /** 观战者离开 */
  leaveSpectator(conn: ClientConn): void {
    this.spectators.delete(conn);
    this.spectatorSeats.delete(conn);
    conn.room = null;
    this.broadcastRoomState();
  }

  /** 观战者切换视角：seat 0..3 看该座位手牌，null 隐藏手牌 */
  setSpectatorSeat(conn: ClientConn, seat: SeatId | null): void {
    if (!this.spectators.has(conn)) return;
    if (seat === null) this.spectatorSeats.delete(conn);
    else this.spectatorSeats.set(conn, seat);
    this.sendSpectatorView(conn); // 立即推送新视角
  }

  leave(seat: SeatId): void {
    const s = this.seats[seat];
    this.conns[seat] = null;
    if (this.started) {
      // 牌局中离开：座位保留，断线托管（机器人接管）
      s.connected = false;
    } else {
      s.kind = 'open';
      s.ready = false;
      s.connected = false;
      s.token = null;
      s.name = '';
      if (this.hostSeat === seat) {
        const nextHost = SEAT_IDS.find((x) => this.seats[x].kind === 'human' && this.conns[x]);
        if (nextHost !== undefined) this.hostSeat = nextHost;
      }
    }
    this.broadcastRoomState();
  }

  get humanCount(): number {
    return this.seats.filter((s, i) => s.kind === 'human' && this.conns[i]).length;
  }

  isEmpty(): boolean {
    return this.humanCount === 0 && this.spectators.size === 0;
  }

  addBot(hostConn: ClientConn, seat: number, level: BotLevel = 'normal', llm = false): string | null {
    if (hostConn.room !== this || hostConn.seat !== this.hostSeat) return '只有房主可以添加机器人';
    if (this.started) return '牌局进行中';
    if (seat < 0 || seat > 3) return '座位号无效';
    const s = this.seats[seat];
    if (s.kind === 'human') return '该座位已有玩家';
    s.kind = 'bot';
    s.llm = llm;
    s.name = llm
      ? `AI·Qwen`
      : `电脑·${level === 'easy' ? '简单' : level === 'hard' ? '困难' : level === 'expert' ? '专家' : '普通'}`;
    s.botLevel = level;
    s.ready = true;
    s.connected = true;
    this.broadcastRoomState();
    return null;
  }

  removeBot(hostConn: ClientConn, seat: number): string | null {
    if (hostConn.room !== this || hostConn.seat !== this.hostSeat) return '只有房主可以移除机器人';
    if (this.started) return '牌局进行中';
    if (seat < 0 || seat > 3) return '座位号无效';
    if (this.seats[seat].kind !== 'bot') return '该座位不是机器人';
    this.seats[seat] = {
      kind: 'open',
      name: '',
      ready: false,
      connected: false,
      botLevel: 'normal',
      llm: false,
      token: null,
    };
    this.broadcastRoomState();
    return null;
  }

  setReady(seat: SeatId, ready: boolean): void {
    if (this.seats[seat].kind === 'human') {
      this.seats[seat].ready = ready;
      this.broadcastRoomState();
    }
  }

  start(hostConn: ClientConn): string | null {
    if (hostConn.room !== this || hostConn.seat !== this.hostSeat) return '只有房主可以开始游戏';
    if (this.seats.some((s) => s.kind === 'open')) return '还有空位，请添加机器人或等待玩家';
    const notReady = this.seats.some(
      (s, i) => s.kind === 'human' && i !== this.hostSeat && !s.ready,
    );
    if (notReady) return '还有玩家未准备';
    if (this.started) return '游戏已开始';
    this.started = true;
    this.engine = createInitialMatch(DEFAULT_RULES);
    // 广播 started=true，让所有客户端从房间页跳转到牌桌（否则非房主玩家收不到转换消息）
    this.broadcastRoomState();
    this.applyInternal({ t: 'deal' });
    return null;
  }

  get isStarted(): boolean {
    return this.started;
  }

  // ————— 消息与牌局 —————

  roomState(): RoomStateMsg {
    return {
      roomId: this.id,
      phase: this.started ? 'playing' : 'lobby',
      host: this.hostSeat,
      started: this.started,
      spectators: this.spectators.size,
      seats: this.seats.map((s, seat): RoomSeatInfo => ({
        seat,
        kind: s.kind,
        name: s.name,
        ready: s.ready,
        connected: s.connected,
        botLevel: s.kind === 'bot' ? s.botLevel : undefined,
        llm: s.kind === 'bot' ? s.llm : undefined,
      })),
    };
  }

  /** 观战者视图：选了座位则看该座位手牌（肩上视角），否则无手牌只读 */
  private spectatorViewOf(c: ClientConn): GameView {
    const seat = this.spectatorSeats.get(c);
    if (seat === undefined) {
      const v = viewOf(this.engine, 0);
      return { ...v, you: -1 as GameView['you'], hand: [] };
    }
    return viewOf(this.engine, seat);
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const c of this.conns) if (c) this.safeSend(c, data);
    for (const c of this.spectators) this.safeSend(c, data);
  }

  broadcastRoomState(): void {
    this.broadcast({ type: 'roomState', payload: this.roomState() });
  }

  broadcastViews(events: EngineEvent[]): void {
    this.seq++;
    for (const seat of SEAT_IDS) {
      const c = this.conns[seat];
      if (!c) continue;
      this.safeSend(
        c,
        JSON.stringify({
          type: 'gameEvents',
          payload: { view: viewOf(this.engine, seat), events, seq: this.seq },
        } satisfies ServerMsg),
      );
    }
    // 观战者收无手牌只读视图
    for (const c of this.spectators) this.sendSpectatorView(c, events, this.seq);
  }

  sendSnapshot(seat: SeatId): void {
    const c = this.conns[seat];
    if (!c) return;
    this.safeSend(
      c,
      JSON.stringify({
        type: 'gameSnapshot',
        payload: { view: viewOf(this.engine, seat), roomState: this.roomState(), seq: this.seq },
      } satisfies ServerMsg),
    );
  }

  private sendSpectatorView(c: ClientConn, events?: EngineEvent[], seq?: number): void {
    const view = this.spectatorViewOf(c);
    const payload = events
      ? { type: 'gameEvents' as const, payload: { view, events, seq: seq ?? this.seq } }
      : { type: 'gameSnapshot' as const, payload: { view, roomState: this.roomState(), seq: this.seq } };
    this.safeSend(c, JSON.stringify(payload));
  }

  private safeSend(c: ClientConn, data: string): void {
    try {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    } catch {
      /* 连接已断则忽略 */
    }
  }

  /** 人类动作入口（动作座位由服务器确定，杜绝伪造） */
  applyHuman(conn: ClientConn, action: Action): { ok: boolean; error?: string } {
    if (conn.room !== this || conn.seat === null) return { ok: false, error: '不在房间中' };
    if (action.t === 'deal') return { ok: false, error: '发牌由服务器调度' };
    if (action.seat !== conn.seat) return { ok: false, error: '只能操作自己的座位' };
    return this.applyInternal(action);
  }

  private applyInternal(action: Action): { ok: boolean; error?: string } {
    const res = applyAction(this.engine, action, this.rng);
    if (!res.ok) return res;
    this.engine = res.state;
    this.broadcastViews(res.events);
    this.schedule();
    return { ok: true };
  }

  /** 调度机器人/托管与自动开下一局 */
  schedule(): void {
    for (const t of this.botTimers) if (t) clearTimeout(t);
    this.botTimers = [null, null, null, null];
    if (this.autoTimer) clearTimeout(this.autoTimer);
    if (!this.started) return;
    if (this.engine.phase === 'matchOver') {
      // 整场结束：回到房间等待再来一局
      this.started = false;
      for (const s of this.seats) if (s.kind === 'human') s.ready = false;
      this.broadcastRoomState();
      return;
    }
    if (this.engine.phase === 'handOver') {
      const epoch = ++this.scheduleEpoch;
      this.autoTimer = setTimeout(() => {
        if (epoch !== this.scheduleEpoch || !this.started) return;
        this.applyInternal({ t: 'deal' });
      }, this.opts.nextHandDelay);
      return;
    }
    const seat = actorSeat(this.engine);
    const s = this.seats[seat];
    const isBot = s.kind === 'bot' || (s.kind === 'human' && !this.conns[seat]); // 断线托管
    if (!isBot) return;
    const [dmin, dmax] = this.opts.botDelay;
    const delay = dmin + Math.random() * Math.max(0, dmax - dmin);
    const epoch = this.scheduleEpoch;
    const brain: BotBrain = {
      level: s.botLevel,
      advisor: s.llm && this.advisor ? this.advisor : undefined,
    };
    this.botTimers[seat] = setTimeout(() => {
      void (async () => {
        if (epoch !== this.scheduleEpoch) return;
        if (this.conns[seat]) return; // 玩家已重连，交还控制权
        const view = viewOf(this.engine, seat);
        const action = await botActionWithBrain(view, brain, this.rng);
        // LLM 等待期间对局可能已被其它事件推进（如断线托管重调度），再次校验
        if (epoch !== this.scheduleEpoch) return;
        this.applyInternal(action);
      })();
    }, delay);
  }

  private scheduleEpoch = 0;

  /** 断线通知（牌局中→托管；大厅中→释放座位） */
  onDisconnect(seat: SeatId): void {
    this.conns[seat] = null;
    const s = this.seats[seat];
    if (this.started) {
      s.connected = false;
      this.broadcastRoomState();
      this.schedule(); // 立即考虑托管
    } else {
      this.leave(seat);
    }
  }

  dispose(): void {
    this.scheduleEpoch++;
    for (const t of this.botTimers) if (t) clearTimeout(t);
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }
}

/** 生成房间号（去除易混淆字符） */
export function genRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
