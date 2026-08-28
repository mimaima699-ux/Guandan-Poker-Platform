import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

// 防御：若环境里设了 ELECTRON_RUN_AS_NODE=1（会让 electron 以纯 Node 模式跑、拿不到 app API），立即清除。
// 该变量在主进程入口已被 Node 加载后才读到，但清除后可保证后续 require('electron') 子模块正常、并避免传染子进程。
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

/**
 * 掼蛋桌面版主进程：
 * - 生产模式：加载打包好的 server.cjs（同进程内 startServer），BrowserWindow 打开 http://localhost:<port>
 * - 开发模式（GUANDAN_DEV=1）：连 5173 的 Vite，服务器由 tsx 单独跑
 *
 * 服务器同时托管客户端静态文件（packages/client/dist），所以局域网朋友
 * 浏览器访问 http://<主机IP>:<port> 也能加入房间 —— 与现有 wsUrl() 逻辑无缝衔接。
 */

const DEV = !!process.env.GUANDAN_DEV;
const FIXED_PORT = 3000;

let serverPort = FIXED_PORT;
let closeServer: (() => Promise<void>) | null = null;

async function bootServer(): Promise<void> {
  if (DEV) return; // 开发模式服务器由 tsx 单独跑在 3000
  // 指向打包进 resources 的客户端静态文件，供服务器托管（局域网朋友也能拉到页面）
  process.env.GUANDAN_CLIENT_DIST = join(process.resourcesPath, 'client-dist');
  // 加载 esbuild 打包好的服务器 bundle（CJS）
  const serverPath = join(__dirname, 'server.cjs');
  const serverMod = require(serverPath);
  const startServer = serverMod.startServer as (opts: { port?: number }) => Promise<{
    port: number;
    close(): Promise<void>;
  }>;
  try {
    const srv = await startServer({ port: FIXED_PORT });
    serverPort = srv.port;
    closeServer = srv.close;
    console.log(`掼蛋服务器已启动：http://localhost:${serverPort}`);
  } catch (e) {
    console.error('服务器启动失败（端口可能被占用）:', e);
    throw e;
  }
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#1a1612',
    title: '掼蛋',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 外链在系统浏览器打开，不抢主窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (DEV) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadURL(`http://localhost:${serverPort}`);
  }
}

// 单实例：第二个实例聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      const w = wins[0];
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await bootServer();
      await createWindow();
    } catch {
      // 服务器起不来（端口占用等），弹原生提示后退出
      const { dialog } = await import('electron');
      dialog.showErrorBox(
        '启动失败',
        `游戏服务器无法启动（端口 ${FIXED_PORT} 可能被占用）。\n请关闭占用该端口的程序后重试。`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async () => {
    if (closeServer) {
      try {
        await closeServer();
      } catch {
        /* ignore */
      }
    }
  });
}
