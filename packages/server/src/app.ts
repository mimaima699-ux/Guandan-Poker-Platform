import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { PROTOCOL_VERSION, type AdvisorConfig, type BotLevel, type ClientMsg, type SeatId, type ServerMsg } from '@guandan/core';
import { Room, genRoomId, type ClientConn, type RoomOptions } from './room';

// __dirname：兼容 ESM（tsx/dev）与 CJS（esbuild 打包进 Electron）
const __dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : fileURLToPath(new URL('.', import.meta.url));
/** 客户端静态文件目录：优先用环境变量（Electron 打包时指向 resources/client-dist），否则开发相对路径 */
const CLIENT_DIST = process.env.GUANDAN_CLIENT_DIST
  ? join(process.env.GUANDAN_CLIENT_DIST)
  : join(__dirname, '../../client/dist');
const HEARTBEAT_MS = 30_000;

export interface AppOptions extends RoomOptions {
  port?: number;
}

export interface App {
  httpServer: import('node:http').Server;
  wss: WebSocketServer;
  rooms: Map<string, Room>;
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

/** 从环境变量读取本地 LLM（Ollama）顾问配置；未配置时用默认 localhost + qwen2.5:7b */
function advisorFromEnv(): AdvisorConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 8000) || 8000,
  };
}

/** 消息校验 schema */
const schemas = {
  hello: z.object({ token: z.string().min(6).max(64).optional(), name: z.string().min(1).max(12).optional() }),
  createRoom: z.object({ name: z.string().min(1).max(12).optional() }),
  joinRoom: z.object({ roomId: z.string().length(4), name: z.string().min(1).max(12).optional(), spectate: z.boolean().optional() }),
  addBot: z.object({ seat: z.number().int().min(0).max(3), level: z.enum(['easy', 'normal', 'hard', 'expert']).optional(), llm: z.boolean().optional() }),
  removeBot: z.object({ seat: z.number().int().min(0).max(3) }),
  setReady: z.object({ ready: z.boolean() }),
  startGame: z.object({}),
  tribute: z.object({ card: z.number().int().min(0).max(255) }),
  returnTribute: z.object({ card: z.number().int().min(0).max(255) }),
  play: z.object({ cards: z.array(z.number().int().min(0).max(255)).min(1).max(15), interpId: z.number().int().min(0).max(15) }),
  pass: z.object({}),
  chat: z.object({ text: z.string().min(1).max(200) }),
  spectateSeat: z.object({ seat: z.number().int().min(-1).max(3) }),
  leaveRoom: z.object({}),
} as const;

const envelope = z.object({
  v: z.number().optional(),
  type: z.string(),
  payload: z.unknown().optional(),
});

/** 启动服务器（端口 0 = 随机；botDelay/nextHandDelay 可注入便于测试） */
export function startServer(opts: AppOptions = {}): Promise<App> {
  const rooms = new Map<string, Room>();
  const conns = new Set<ClientConn>();

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!existsSync(CLIENT_DIST)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('掼蛋服务器运行中（开发模式：请通过 Vite 访问客户端 http://localhost:5173）');
      return;
    }
    let url = (req.url ?? '/').split('?')[0];
    if (url === '/') url = '/index.html';
    let file = join(CLIENT_DIST, url);
    if (!file.startsWith(CLIENT_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(CLIENT_DIST, 'index.html'); // SPA 回退
    }
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

  function send(conn: ClientConn, msg: ServerMsg): void {
    try {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  function sendError(conn: ClientConn, code: string, message: string): void {
    send(conn, { type: 'error', payload: { code, message } });
  }

  function maybeGcRoom(room: Room): void {
    if (!room.isEmpty()) return;
    if (!room.isStarted) {
      room.dispose();
      rooms.delete(room.id);
      return;
    }
    // 牌局中全员断线：保留 5 分钟供重连（期间机器人托管），之后回收
    const id = room.id;
    const timer = setTimeout(() => {
      const r = rooms.get(id);
      if (r && r.isEmpty()) {
        r.dispose();
        rooms.delete(id);
      }
    }, 5 * 60_000);
    timer.unref?.();
  }

  async function handleMessage(conn: ClientConn, type: ClientMsg['type'], p: Record<string, never>): Promise<void> {
    switch (type) {
      case 'hello': {
        conn.token = (p.token as unknown as string) || randomUUID();
        conn.name = (p.name as unknown as string) || conn.name;
        for (const room of rooms.values()) {
          for (let seat = 0; seat < 4; seat++) {
            if (room.roomState().seats[seat].kind === 'human') {
              if (room.rebindConn(seat as SeatId, conn)) {
                send(conn, { type: 'youAre', payload: { seat, token: conn.token, roomId: room.id } });
                room.broadcastRoomState();
                if (room.isStarted) room.sendSnapshot(seat as SeatId);
                return;
              }
            }
          }
        }
        send(conn, { type: 'youAre', payload: { seat: -1, token: conn.token, roomId: null } });
        return;
      }
      case 'createRoom': {
        if (conn.room) return sendError(conn, 'IN_ROOM', '你已在房间中');
        let id = genRoomId();
        while (rooms.has(id)) id = genRoomId();
        const room = new Room(id, { ...opts, advisor: opts.advisor ?? advisorFromEnv() });
        rooms.set(id, room);
        const seat = room.join(conn);
        if (seat === null) {
          rooms.delete(id);
          return sendError(conn, 'ROOM_FULL', '房间已满');
        }
        send(conn, { type: 'youAre', payload: { seat, token: conn.token, roomId: id } });
        return;
      }
      case 'joinRoom': {
        if (conn.room) return sendError(conn, 'IN_ROOM', '你已在房间中');
        const room = rooms.get(p.roomId as unknown as string);
        if (!room) return sendError(conn, 'NO_ROOM', '房间不存在');
        const spectate = (p.spectate as unknown as boolean) ?? false;
        if (spectate) {
          room.joinSpectate(conn);
          send(conn, { type: 'youAre', payload: { seat: -1, token: conn.token, roomId: room.id } });
          return;
        }
        const seat = room.join(conn);
        if (seat === null) return sendError(conn, 'ROOM_FULL', '房间已满');
        send(conn, { type: 'youAre', payload: { seat, token: conn.token, roomId: room.id } });
        if (room.isStarted) room.sendSnapshot(seat);
        return;
      }
      case 'addBot': {
        if (!conn.room) return sendError(conn, 'NO_ROOM', '不在房间中');
        const err = conn.room.addBot(
          conn,
          p.seat as unknown as number,
          (p.level as unknown as BotLevel) ?? 'normal',
          (p.llm as unknown as boolean) ?? false,
        );
        if (err) sendError(conn, 'NOT_ALLOWED', err);
        return;
      }
      case 'removeBot': {
        if (!conn.room) return sendError(conn, 'NO_ROOM', '不在房间中');
        const err = conn.room.removeBot(conn, p.seat as unknown as number);
        if (err) sendError(conn, 'NOT_ALLOWED', err);
        return;
      }
      case 'setReady': {
        if (!conn.room || conn.seat === null) return sendError(conn, 'NO_ROOM', '不在房间中');
        conn.room.setReady(conn.seat, p.ready as unknown as boolean);
        return;
      }
      case 'startGame': {
        if (!conn.room) return sendError(conn, 'NO_ROOM', '不在房间中');
        const err = conn.room.start(conn);
        if (err) sendError(conn, 'NOT_ALLOWED', err);
        return;
      }
      case 'tribute':
      case 'returnTribute': {
        if (!conn.room || conn.seat === null) return sendError(conn, 'NO_ROOM', '不在房间中');
        const card = p.card as unknown as number;
        const res = conn.room.applyHuman(
          conn,
          type === 'tribute' ? { t: 'tribute', seat: conn.seat, card } : { t: 'returnTribute', seat: conn.seat, card },
        );
        if (!res.ok) sendError(conn, 'ILLEGAL_MOVE', res.error ?? '非法动作');
        return;
      }
      case 'play': {
        if (!conn.room || conn.seat === null) return sendError(conn, 'NO_ROOM', '不在房间中');
        const res = conn.room.applyHuman(conn, {
          t: 'play',
          seat: conn.seat,
          cards: p.cards as unknown as number[],
          interpId: p.interpId as unknown as number,
        });
        if (!res.ok) sendError(conn, 'ILLEGAL_MOVE', res.error ?? '非法动作');
        return;
      }
      case 'pass': {
        if (!conn.room || conn.seat === null) return sendError(conn, 'NO_ROOM', '不在房间中');
        const res = conn.room.applyHuman(conn, { t: 'pass', seat: conn.seat });
        if (!res.ok) sendError(conn, 'ILLEGAL_MOVE', res.error ?? '非法动作');
        return;
      }
      case 'chat': {
        if (!conn.room) return sendError(conn, 'NO_ROOM', '不在房间中');
        const text = (p.text as unknown as string).trim();
        if (!text) return;
        conn.room.broadcast({
          type: 'chatMsg',
          payload: { seat: conn.seat ?? -1, name: conn.name, text },
        });
        return;
      }
      case 'spectateSeat': {
        if (!conn.room || conn.seat !== null) return sendError(conn, 'NOT_ALLOWED', '仅观战者可切换视角');
        const seat = p.seat as unknown as number;
        conn.room.setSpectatorSeat(conn, seat === -1 ? null : (seat as SeatId));
        return;
      }
      case 'leaveRoom': {
        if (conn.room) {
          const room = conn.room;
          if (conn.seat !== null) room.leave(conn.seat);
          else room.leaveSpectator(conn);
          conn.room = null;
          conn.seat = null;
          send(conn, { type: 'youAre', payload: { seat: -1, token: conn.token, roomId: null } });
          maybeGcRoom(room);
        }
        return;
      }
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    const conn: ClientConn = { ws, room: null, seat: null, token: '', name: '玩家', alive: true };
    conns.add(conn);
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (raw) => {
      let msg: z.infer<typeof envelope>;
      try {
        msg = envelope.parse(JSON.parse(String(raw)));
      } catch {
        sendError(conn, 'BAD_MSG', '无法解析的消息');
        return;
      }
      const type = msg.type as ClientMsg['type'];
      const schema = schemas[type];
      if (!schema) {
        sendError(conn, 'BAD_TYPE', `未知消息类型: ${type}`);
        return;
      }
      const parsed = schema.safeParse(msg.payload ?? {});
      if (!parsed.success) {
        sendError(conn, 'BAD_PAYLOAD', `消息格式错误: ${type}`);
        return;
      }
      handleMessage(conn, type, parsed.data as Record<string, never>).catch((e) => {
        console.error('消息处理异常', type, e);
        sendError(conn, 'INTERNAL', '服务器内部错误');
      });
    });
    ws.on('close', () => {
      conns.delete(conn);
      if (conn.room) {
        const room = conn.room;
        conn.room = null;
        if (conn.seat !== null) room.onDisconnect(conn.seat);
        else room.leaveSpectator(conn);
        maybeGcRoom(room);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);

  return new Promise<App>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port ?? 3000, () => {
      const port = (httpServer.address() as { port: number }).port;
      const app: App = {
        httpServer,
        wss,
        rooms,
        port,
        close: async () => {
          clearInterval(heartbeat);
          for (const room of rooms.values()) room.dispose();
          rooms.clear();
          for (const conn of conns) conn.ws.terminate();
          conns.clear();
          await new Promise<void>((res) => {
            wss.close(() => res());
            httpServer.close(() => res());
          });
        },
      };
      if (existsSync(CLIENT_DIST)) {
        console.log(`掼蛋服务器: http://localhost:${port}（托管客户端，协议 v${PROTOCOL_VERSION}）`);
      } else {
        console.log(`掼蛋服务器: http://localhost:${port}（仅 WebSocket，协议 v${PROTOCOL_VERSION}）`);
      }
      resolve(app);
    });
  });
}
