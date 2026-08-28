/**
 * 服务器打包入口：re-export startServer（来自 app，非会自启动的 index.ts），
 * 供 Electron 主进程按需调用。esbuild 内联 @guandan/core + zod，ws 标 external。
 */
export { startServer } from '../../server/src/app';
