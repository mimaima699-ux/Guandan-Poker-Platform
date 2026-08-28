// @guandan/desktop 构建脚本：esbuild 打包主进程 + 服务器为 CJS
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
};

// 别名：把 workspace 包指向源码 .ts（core 以原始 TS 消费）
const alias = {
  '@guandan/core': resolve(root, 'packages/core/src/index.ts'),
};

await Promise.all([
  // 主进程：external electron（运行时提供）
  build({
    ...common,
    entryPoints: [resolve(here, '../src/main.ts')],
    outfile: resolve(here, '../dist/main.cjs'),
    external: ['electron'],
    alias,
  }),
  // 服务器：ws/zod 全部内联（ws 纯 JS，无原生绑定也回退可用，省去打包 node_modules）
  build({
    ...common,
    entryPoints: [resolve(here, '../src/server-entry.ts')],
    outfile: resolve(here, '../dist/server.cjs'),
    alias,
  }),
]);

console.log('✓ desktop build 完成');
