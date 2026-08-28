import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  botAction,
  mulberry32,
  type GameView,
  type RoomStateMsg,
  type ServerMsg,
} from '@guandan/core';
import { startServer, type App } from '../src/app';

/** 测试客户端：消息队列 + 条件等待 */
class TestClient {
  ws: WebSocket;
  private queue: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMsg;
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  opened(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
  }

  send(type: string, payload: unknown): void {
    this.ws.send(JSON.stringify({ v: 1, type, payload }));
  }

  next(pred: (m: ServerMsg) => boolean, timeoutMs = 10000): Promise<ServerMsg> {
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const j = this.waiters.findIndex((w) => w.resolve === resolve);
        if (j >= 0) this.waiters.splice(j, 1);
        reject(new Error('等待消息超时'));
      }, timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('联机服务器 E2E', () => {
  let app: App;
  let url: string;

  beforeAll(async () => {
    app = await startServer({ port: 0, botDelay: [0, 2], nextHandDelay: 5 });
    url = `ws://127.0.0.1:${app.port}`;
  }, 20000);

  afterAll(async () => {
    await app.close();
  });

  it('1 人 + 3 机器人完整打一场，含进贡/出牌/结算/回大厅', async () => {
    const c = new TestClient(url);
    await c.opened();
    c.send('hello', { token: 'e2e-token-0001', name: '测试者' });
    const helloBack = await c.next((m) => m.type === 'youAre');
    expect(helloBack.type === 'youAre' && helloBack.payload.seat).toBe(-1);

    c.send('createRoom', {});
    const youAre = await c.next((m) => m.type === 'youAre' && m.payload.seat >= 0);
    const roomId = youAre.type === 'youAre' ? youAre.payload.roomId : null;
    expect(roomId).toBeTruthy();

    c.send('addBot', { seat: 1, level: 'hard' });
    c.send('addBot', { seat: 2, level: 'hard' });
    c.send('addBot', { seat: 3, level: 'hard' });
    await c.next(
      (m) => m.type === 'roomState' && m.payload.seats.every((s) => s.kind !== 'open'),
    );

    // 非法消息：牌局未开始时出牌被拒
    c.send('play', { cards: [0], interpId: 0 });
    const err = await c.next((m) => m.type === 'error');
    expect(err.type === 'error' && err.payload.code).toBe('ILLEGAL_MOVE');

    // 已在房间中再加入其他房间被拒
    c.send('joinRoom', { roomId: 'ZZZZ' });
    const err2 = await c.next((m) => m.type === 'error');
    expect(err2.type === 'error' && err2.payload.code).toBe('IN_ROOM');

    c.send('startGame', {});
    // 确认开局用 roomState(started=true)：若改等 gameEvents，发牌消息会被吞掉，
    // 先手恰好是自己（0 号位）时会因为错过“轮到你出牌”而永久卡死。
    await c.next((m) => m.type === 'roomState' && m.payload.started === true);

    // 打完整场：自己的回合就发 botAction 动作
    const rng = mulberry32(777);
    let view: GameView | null = null;
    let sawStarted = true; // 上一步已确认开局
    let lastError: string | null = null;
    (c as TestClient & { ws: WebSocket }).ws.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as ServerMsg;
        if (m.type === 'error') lastError = `${m.payload.code}:${m.payload.message}`;
      } catch {
        /* ignore */
      }
    });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const msg = await Promise.race([
        c.next((m) => m.type === 'gameEvents' || m.type === 'gameSnapshot' || m.type === 'roomState'),
        new Promise<never>((_, rej) =>
          setTimeout(
            () =>
              rej(
                new Error(
                  `等待超时: view.phase=${view?.phase} turn=${view?.turn} you=${view?.you} ` +
                    `oweT=${view?.tribute?.youOweTribute} oweR=${view?.tribute?.youOweReturn} ` +
                    `lastErr=${lastError ?? '无'}`,
                ),
              ),
            10_000,
          ),
        ),
      ]);
      if (msg.type === 'gameEvents' || msg.type === 'gameSnapshot') {
        view = msg.payload.view as GameView;
        const v = view;
        const needAct =
          v.phase === 'playing' ||
          (v.tribute?.youOweTribute ?? false) ||
          (v.tribute?.youOweReturn ?? false);
        if (needAct) {
          const action = botAction(v, 'hard', rng);
          if (action.t === 'play') c.send('play', { cards: action.cards, interpId: action.interpId });
          else if (action.t === 'pass') c.send('pass', {});
          else if (action.t === 'tribute') c.send('tribute', { card: action.card });
          else if (action.t === 'returnTribute') c.send('returnTribute', { card: action.card });
          // deal：服务器自动调度，忽略
        }
      } else if (msg.type === 'roomState') {
        const rs = msg.payload as RoomStateMsg;
        if (rs.started) sawStarted = true;
        else if (sawStarted) break; // 比赛结束回大厅
      }
    }
    expect(sawStarted).toBe(true);
    c.close();
  }, 150_000);

  it('断线托管与重连恢复', async () => {
    const c = new TestClient(url);
    await c.opened();
    c.send('hello', { token: 'e2e-token-0002', name: '断线者' });
    await c.next((m) => m.type === 'youAre');
    c.send('createRoom', {});
    const youAre = await c.next((m) => m.type === 'youAre' && m.payload.seat >= 0);
    expect(youAre.type === 'youAre' && youAre.payload.seat).toBe(0);
    c.send('addBot', { seat: 1 });
    c.send('addBot', { seat: 2 });
    c.send('addBot', { seat: 3 });
    await c.next((m) => m.type === 'roomState' && m.payload.seats.every((s) => s.kind !== 'open'));
    c.send('startGame', {});
    await c.next((m) => m.type === 'gameEvents' || m.type === 'gameSnapshot');

    // 断线：机器人应托管推进牌局
    c.close();
    await new Promise((r) => setTimeout(r, 800));

    // 重连：同 token 自动回归座位并收到快照
    const c2 = new TestClient(url);
    await c2.opened();
    c2.send('hello', { token: 'e2e-token-0002', name: '断线者' });
    const back = await c2.next((m) => m.type === 'youAre' && m.payload.seat >= 0);
    expect(back.type === 'youAre' && back.payload.seat).toBe(0);
    const snap = await c2.next((m) => m.type === 'gameSnapshot');
    expect(snap.type === 'gameSnapshot' && snap.payload.view.phase).toBeTruthy();
    c2.send('leaveRoom', {});
    await c2.next((m) => m.type === 'youAre' && m.payload.seat === -1);
    c2.close();
  }, 30_000);

  it('观战与聊天：观战者拿到无手牌只读视图，能收发聊天', async () => {
    const host = new TestClient(url);
    await host.opened();
    host.send('hello', { token: 'e2e-token-0003', name: '房主' });
    await host.next((m) => m.type === 'youAre');
    host.send('createRoom', {});
    const youAre = await host.next((m) => m.type === 'youAre' && m.payload.seat >= 0);
    const roomId = youAre.type === 'youAre' ? youAre.payload.roomId : null;
    expect(roomId).toBeTruthy();
    host.send('addBot', { seat: 1 });
    host.send('addBot', { seat: 2 });
    host.send('addBot', { seat: 3 });
    await host.next((m) => m.type === 'roomState' && m.payload.seats.every((s) => s.kind !== 'open'));
    host.send('startGame', {});
    await host.next((m) => m.type === 'gameEvents' || m.type === 'gameSnapshot');

    const spec = new TestClient(url);
    await spec.opened();
    spec.send('hello', { token: 'e2e-token-0004', name: '观众' });
    await spec.next((m) => m.type === 'youAre' && m.payload.seat === -1);
    spec.send('joinRoom', { roomId: roomId!, spectate: true });
    const specYouAre = await spec.next((m) => m.type === 'youAre' && m.payload.seat === -1 && m.payload.roomId !== null);
    expect(specYouAre.type === 'youAre').toBe(true);

    // 观战者收 roomState（含观战人数）或 gameSnapshot（无手牌）
    const specMsg = await spec.next(
      (m) => m.type === 'roomState' || m.type === 'gameSnapshot' || m.type === 'gameEvents',
    );
    if (specMsg.type === 'roomState') {
      expect(specMsg.payload.spectators).toBeGreaterThanOrEqual(1);
    } else {
      expect(specMsg.payload.view.hand.length).toBe(0); // 防作弊：不泄露任何一家手牌
    }

    // 观战者发言，房主与观战者都能收到
    spec.send('chat', { text: '好牌！' });
    const chatHost = await host.next((m) => m.type === 'chatMsg');
    expect(chatHost.type === 'chatMsg' && chatHost.payload.text).toBe('好牌！');
    const chatSpec = await spec.next((m) => m.type === 'chatMsg');
    expect(chatSpec.type === 'chatMsg' && chatSpec.payload.text).toBe('好牌！');

    // 切换视角看 0 号位：拿到带手牌的视图
    spec.send('spectateSeat', { seat: 0 });
    const sv = await spec.next((m) => m.type === 'gameSnapshot' && m.payload.view.hand.length > 0);
    expect(sv.type === 'gameSnapshot' && sv.payload.view.you).toBe(0);

    host.close();
    spec.close();
  }, 30_000);
});
