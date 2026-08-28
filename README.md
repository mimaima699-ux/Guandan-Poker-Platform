# 掼蛋 · Guandan

一个用 TypeScript 实现的完整掼蛋（Guandan）游戏：引擎、AI、Web 客户端、联机服务器，以及可打包成 Windows 安装包的桌面版。

> 掼蛋是流行于中国的四人扑克牌游戏，两两一队，以打升级为核心玩法。本仓库实现了完整的规则、牌型识别、进贡还贡、升级体系，以及四个难度的电脑 AI。

---

## 特性

- **完整的掼蛋规则引擎** —— 牌型识别（单/对/三/三带二/顺子/连对/三连三/炸弹/同花顺/火箭等）、压牌判定、进贡还贡、级牌与百搭（逢人配）、升级体系。
- **四档电脑 AI** —— 简单 / 普通 / 困难 / 专家。专家档融合记牌、手牌拆解（估算出完所需手数）、蒙特卡洛 rollout，相对困难档 head-to-head 胜率约 55%。
- **可选本地 LLM 顾问** —— 接入本地 [Ollama](https://ollama.com)（默认 qwen2.5:7b）辅助 AI 选牌，合法候选由引擎枚举，杜绝幻觉非法牌。
- **单机 + 局域网联机** —— 单机直接打三位电脑；联机模式下同一局域网的好友用浏览器即可加入房间同桌对战。
- **观战与回放** —— 支持观战视角切换、整局回放。
- **桌面应用** —— Electron 打包成 Windows 安装包，双击即玩。

---

## 技术栈

| 模块 | 技术 |
|---|---|
| `packages/core` 游戏引擎 | TypeScript（牌型/规则/AI，纯逻辑，无运行时依赖） |
| `packages/client` 前端 | React + Vite + Zustand |
| `packages/server` 联机服务器 | Node.js + `ws`（WebSocket）+ `zod` |
| `packages/desktop` 桌面版 | Electron + electron-builder |

pnpm workspace 单仓多包，`@guandan/core` 以原始 TypeScript 源码被各端直接消费（tsx / Vite / esbuild），无需预构建。

---

## 快速开始

### 环境要求

- Node.js ≥ 20
- pnpm（仓库使用 pnpm@10，`packageManager` 字段已声明）

### 安装与开发

```bash
pnpm install

# 单机/联机 Web 开发（同时起前端 5173 + 服务器 3000）
pnpm dev

# 仅前端
pnpm dev:client
# 仅服务器
pnpm dev:server
```

浏览器打开 [http://localhost:5173](http://localhost:5173) → 大厅选难度 → 开始游戏。

### 局域网联机

1. 启动服务器：`pnpm dev:server`（同时托管客户端页面）
2. 查看本机局域网 IP（`ipconfig`）
3. 同一 Wi-Fi 下的好友浏览器访问 `http://你的IP:5173`（开发模式）或 `http://你的IP:3000`（仅服务器模式）
4. 创建房间 → 把 4 位房间号发给好友 → 好友"加入房间"

> Windows 首次启动会弹防火墙授权，需允许 Node.js 访问"专用网络"，否则好友连不上。

### 测试 / 类型检查

```bash
pnpm test        # 全包跑 vitest
pnpm typecheck   # tsc 类型检查
```

### AI 对战模拟

```bash
pnpm sim --matchup=expert:hard   # 专家 vs 困难 head-to-head（注意带等号）
```

---

## 桌面版（Windows 安装包）

把整套应用打包成一个 Windows 安装程序（含 Chromium，约 79MB），双击安装即玩，单机和局域网联机都保留。

```bash
# 构建客户端 + 主进程/服务器 bundle
pnpm desktop:build

# 生成安装包 → packages/desktop/release/掼蛋 Setup x.x.x.exe
pnpm desktop:dist

# 桌面版开发（热重载）
pnpm desktop:dev
```

桌面版启动时会在进程内启动游戏服务器（3000 端口）并打开窗口；局域网好友仍可浏览器访问 `http://你的IP:3000` 加入。

> **打包提示**：国内网络下 electron-builder 下载 Electron 二进制会超时，请设置镜像：
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
> ```

---

## 可选：接入本地 AI（Ollama）

让电脑用本地大模型辅助选牌（更聪明，但每次出牌约多 3.5 秒）：

1. 安装并启动 [Ollama](https://ollama.com)，拉取模型：`ollama pull qwen2.5:7b`
2. 大厅勾选"电脑用本地 Qwen"，填入 Ollama 地址（默认 `http://localhost:11434/v1`）和模型名
3. 联机模式由服务器直连，通过环境变量配置：
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434/v1 \
   OLLAMA_MODEL=qwen2.5:7b \
   OLLAMA_TIMEOUT_MS=8000 pnpm dev:server
   ```

> Web 单机模式浏览器直连 Ollama 需跨域，启动 Ollama 时加 `OLLAMA_ORIGINS=*`；桌面版无此问题。

AI 架构是"顾问"模式：引擎枚举所有合法候选 → LLM 只在候选中选下标 → 映射回合法出牌，任何超时/解析失败自动回退到启发式，绝不会生成非法牌。

---

## 项目结构

```
packages/
├── core/      游戏引擎（牌型/规则/AI/协议），纯 TS
├── client/    React Web 客户端
├── server/    联机 WebSocket 服务器
└── desktop/   Electron 桌面版（打包成 Windows 安装包）
```

## License

MIT
