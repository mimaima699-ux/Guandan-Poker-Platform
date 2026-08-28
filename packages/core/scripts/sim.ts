/**
 * AI 对战仿真：pnpm sim [场数] [--matchup hard:easy]
 * 例：pnpm sim 50            → 队0(hard,0/2号位) vs 队1(easy,1/3号位) 打 50 场
 *     pnpm sim 30 normal:hard
 */
import { performance } from 'node:perf_hooks';
import { createInitialMatch } from '../src/engine/state';
import { actorSeat, applyAction } from '../src/engine/engine';
import { viewOf } from '../src/engine/view';
import { botAction, type BotLevel } from '../src/ai/bot';
import { mulberry32 } from '../src/rng';
import { DEFAULT_RULES } from '../src/rules';

const args = process.argv.slice(2);
const games = Number(args.find((a) => !a.startsWith('--')) ?? 30);
const matchupArg = args.find((a) => a.startsWith('--matchup='));
const [team0Bot, team1Bot] = (
  matchupArg ? matchupArg.split('=')[1] : 'hard:easy'
).split(':') as BotLevel[];
// 队 0（0/2 号位）用 team0Bot，队 1（1/3 号位）用 team1Bot
const levels: BotLevel[] = [team0Bot, team1Bot, team0Bot, team1Bot];

const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
const wins: [number, number] = [0, 0];
let hands = 0;
let decisions = 0;
let totalMs = 0;
let maxMs = 0;
const tStart = performance.now();

for (let g = 0; g < games; g++) {
  let state = createInitialMatch(DEFAULT_RULES);
  let guard = 0;
  while (state.phase !== 'matchOver' && guard < 60000) {
    const seat = actorSeat(state);
    const view = viewOf(state, seat);
    const t0 = performance.now();
    const action = botAction(view, levels[seat], rng);
    const dt = performance.now() - t0;
    decisions++;
    totalMs += dt;
    if (dt > maxMs) maxMs = dt;
    const res = applyAction(state, action, rng);
    if (!res.ok) {
      throw new Error(`bot 动作被拒: ${JSON.stringify(action)} → ${res.error} (phase=${state.phase})`);
    }
    state = res.state;
    if (action.t === 'deal') hands++;
    guard++;
  }
  if (state.phase !== 'matchOver') throw new Error('仿真未终止（防死循环保护触发）');
  wins[state.match.winner!]!++;
}

const elapsed = performance.now() - tStart;
console.log('──────── 掼蛋 AI 仿真 ────────');
console.log(`对阵: 队0(${team0Bot}) vs 队1(${team1Bot})`);
console.log(`场次: ${games}  总局数: ${hands}  平均 ${((hands / games) || 0).toFixed(1)} 局/场`);
console.log(
  `胜负: 队0 ${wins[0]} : 队1 ${wins[1]}  → 队0 胜率 ${((wins[0] / games) * 100).toFixed(1)}%`,
);
console.log(
  `决策: ${decisions} 次  平均 ${(totalMs / decisions).toFixed(2)}ms  最大 ${maxMs.toFixed(2)}ms  总耗时 ${(elapsed / 1000).toFixed(1)}s`,
);
