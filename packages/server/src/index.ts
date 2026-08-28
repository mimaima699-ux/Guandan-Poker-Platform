import { startServer } from './app';

const port = Number(process.env.PORT ?? 3000);
startServer({ port }).catch((e) => {
  console.error('服务器启动失败:', e);
  process.exit(1);
});
