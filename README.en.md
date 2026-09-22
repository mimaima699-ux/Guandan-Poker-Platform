# Guandan

English | [简体中文](README.md)

A complete implementation of **Guandan** (掼蛋) — the popular Chinese four-player trick-taking card game — in TypeScript: a rules engine, AI, web client, online server, and a Windows desktop app.

> Guandan is a four-player partnership shedding card game centered on a level-rank progression system. This repo implements the full ruleset, shape recognition, tribute/return, wild cards (逢人配), level progression, and four difficulty tiers of computer AI.

---

## Features

- **Full Guandan rules engine** — shape recognition (single / pair / triple / triple-with-pair / straight / paired-straight / triple-straight / bomb / straight-flush / rockets etc.), beat detection, tribute & return, level cards & wildcards (逢人配), and the level-up system.
- **Four AI tiers** — Easy / Normal / Hard / Expert. The Expert tier combines card counting, hand decomposition (estimating hands-to-go-out), and Monte Carlo rollout, reaching ~55% head-to-head win rate vs Hard.
- **Optional local LLM advisor** — plug in a local [Ollama](https://ollama.com) model (default qwen2.5:7b) to guide AI play. Legal candidates are enumerated by the engine, so the LLM can never produce an illegal card.
- **Single-player & LAN multiplayer** — play solo against three computers, or let friends on the same LAN join a room from their browser.
- **Spectate & replay** — spectate with seat switching, and replay full hands.
- **Desktop app** — packaged as a Windows installer via Electron; install and play with a double-click.

---

## Tech Stack

| Package | Technology |
|---|---|
| `packages/core` engine | TypeScript (pure logic — shapes/rules/AI, no runtime deps) |
| `packages/client` frontend | React + Vite + Zustand |
| `packages/server` online server | Node.js + `ws` (WebSocket) + `zod` |
| `packages/desktop` desktop | Electron + electron-builder |

A pnpm workspace monorepo. `@guandan/core` is consumed as raw TypeScript source by all consumers (tsx / Vite / esbuild), so it needs no pre-build step.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm (the repo pins pnpm@10 via the `packageManager` field)

### Install & Develop

```bash
pnpm install

# Web dev (frontend on 5173 + server on 3000, in parallel)
pnpm dev

# Frontend only
pnpm dev:client
# Server only
pnpm dev:server
```

Open [http://localhost:5173](http://localhost:5173) → pick a difficulty in the lobby → start the game.

### LAN Multiplayer

1. Start the server: `pnpm dev:server` (it also serves the client page)
2. Find your LAN IP (`ipconfig`)
3. Friends on the same Wi-Fi open `http://<your-ip>:5173` (dev mode) or `http://<your-ip>:3000` (server-only mode) in their browser
4. Create a room → share the 4-character room code → friends "Join Room"

> On Windows, the first launch prompts a firewall permission — allow Node.js on "Private networks", or friends can't connect.

### Tests / Typecheck

```bash
pnpm test        # vitest across all packages
pnpm typecheck   # tsc typecheck
```

### AI Simulation

```bash
pnpm sim --matchup=expert:hard   # Expert vs Hard, head-to-head (note the equals sign)
```

---

## Desktop (Windows Installer)

Packages the whole app into a Windows installer (bundles Chromium, ~79MB). Install and play — both single-player and LAN multiplayer are preserved.

```bash
# Build client + main/server bundles
pnpm desktop:build

# Produce the installer → packages/desktop/release/掼蛋 Setup x.x.x.exe
pnpm desktop:dist

# Desktop dev (hot reload)
pnpm desktop:dev
```

On launch, the desktop app starts the game server (port 3000) in-process and opens a window; LAN friends can still join via `http://<your-ip>:3000`.

> **Build note:** on a slow/China network, electron-builder's Electron download from GitHub may time out. Set mirrors:
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
> ```

---

## Optional: Local AI (Ollama)

Let the computer use a local LLM to guide play (smarter, but ~3.5s extra per move):

1. Install and start [Ollama](https://ollama.com), pull a model: `ollama pull qwen2.5:7b`
2. In the lobby, tick "电脑用本地 Qwen" and enter the Ollama URL (default `http://localhost:11434/v1`) and model name
3. For online mode the server connects directly via env vars:
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434/v1 \
   OLLAMA_MODEL=qwen2.5:7b \
   OLLAMA_TIMEOUT_MS=8000 pnpm dev:server
   ```

> In web single-player, the browser connects to Ollama directly and needs CORS — start Ollama with `OLLAMA_ORIGINS=*`. The desktop app has no such issue.

The AI is an "advisor" pattern: the engine enumerates all legal candidates → the LLM only picks an index among them → mapped back to a legal play. Any timeout/parse failure falls back to the heuristic — it can never produce an illegal card.

---

## Project Structure

```
packages/
├── core/      Game engine (shapes/rules/AI/protocol), pure TS
├── client/    React web client
├── server/    Online WebSocket server
└── desktop/   Electron desktop app (packaged as a Windows installer)
```

## License

MIT
