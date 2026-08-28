import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';
import { DEFAULT_RULES } from '../src/rules';
import { createInitialMatch } from '../src/engine/state';
import { actorSeat, applyAction } from '../src/engine/engine';
import { viewOf } from '../src/engine/view';
import { botAction, type BotLevel } from '../src/ai/bot';

/** 机器人整场对打：所有动作必须被引擎接受 */
function runBotMatch(levels: BotLevel[], seed: number, maxHands = 60): number {
  const rng = mulberry32(seed);
  let state = createInitialMatch(DEFAULT_RULES);
  let hands = 0;
  let guard = 0;
  while (state.phase !== 'matchOver' && guard < 80000) {
    if (state.phase === 'handOver' && hands >= maxHands) return hands; // 防止个别场拖太长
    const seat = actorSeat(state);
    const view = viewOf(state, seat);
    const action = botAction(view, levels[seat], rng);
    const res = applyAction(state, action, rng);
    if (!res.ok) {
      throw new Error(`bot 动作被拒: ${JSON.stringify(action)} → ${res.error} (phase=${state.phase})`);
    }
    state = res.state;
    if (action.t === 'deal') hands++;
    guard++;
  }
  expect(state.phase === 'matchOver' || hands >= maxHands).toBe(true);
  return hands;
}

describe('AI 机器人', () => {
  it('normal 机器人整场对打全程合法', () => {
    for (const levels of [
      ['normal', 'normal', 'normal', 'normal'],
      ['easy', 'normal', 'hard', 'easy'],
    ] as BotLevel[][]) {
      for (let seed = 1; seed <= 3; seed++) {
        const hands = runBotMatch(levels, seed * 1000 + 7);
        expect(hands).toBeGreaterThan(0);
      }
    }
  });

  it('hard 对 easy 胜率显著占优（快速样本）', () => {
    const rng = mulberry32(424242);
    let hardWins = 0;
    const games = 12;
    for (let g = 0; g < games; g++) {
      let state = createInitialMatch(DEFAULT_RULES);
      let guard = 0;
      while (state.phase !== 'matchOver' && guard < 80000) {
        const seat = actorSeat(state);
        const view = viewOf(state, seat);
        const lvl: BotLevel = team0Hard(seat);
        const action = botAction(view, lvl, rng);
        const res = applyAction(state, action, rng);
        if (!res.ok) throw new Error(res.ok ? '' : res.error);
        state = res.state;
        guard++;
      }
      if (state.match.winner === 0) hardWins++;
    }
    // hard 队（0/2）对 easy 队（1/3）：12 场至少赢 9 场
    expect(hardWins).toBeGreaterThanOrEqual(9);
  });

  it('决策时延可控', () => {
    const rng = mulberry32(99);
    let state = createInitialMatch(DEFAULT_RULES);
    let max = 0;
    let n = 0;
    let guard = 0;
    while (state.phase !== 'matchOver' && guard < 20000) {
      const seat = actorSeat(state);
      const view = viewOf(state, seat);
      const t0 = performance.now();
      const action = botAction(view, 'hard', rng);
      const dt = performance.now() - t0;
      max = Math.max(max, dt);
      n++;
      const res = applyAction(state, action, rng);
      if (!res.ok) break;
      state = res.state;
      guard++;
    }
    expect(n).toBeGreaterThan(100);
    expect(max).toBeLessThan(50); // 单次决策 < 50ms
  });
});

function team0Hard(seat: number): BotLevel {
  return seat % 2 === 0 ? 'hard' : 'easy';
}
