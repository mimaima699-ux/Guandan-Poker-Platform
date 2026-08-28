import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';
import { DEFAULT_RULES } from '../src/rules';
import { createInitialMatch } from '../src/engine/state';
import { applyAction } from '../src/engine/engine';
import { viewOf } from '../src/engine/view';
import { leadOptions } from '../src/enumerator';
import { makeCtx } from '../src/recognizer';
import { rolloutBest, sampleOpponents } from '../src/ai/rollout';

describe('MC rollout', () => {
  it('sampleOpponents：四份手牌张数正确、且与我的手牌/已打出无重叠', () => {
    const rng = mulberry32(7);
    let state = createInitialMatch(DEFAULT_RULES);
    const dealt = applyAction(state, { t: 'deal' }, rng);
    if (!dealt.ok) throw new Error('deal 失败');
    state = dealt.state;
    const view = viewOf(state, 0);
    const hands = sampleOpponents(view, mulberry32(9));
    expect(hands[0]).toEqual(view.hand);
    const mine = new Set(view.hand);
    for (let seat = 1; seat < 4; seat++) {
      expect(hands[seat].length).toBe(view.handCounts[seat]);
      for (const c of hands[seat]) expect(mine.has(c)).toBe(false);
    }
  });

  it('rolloutBest：能终止并返回合法下标', () => {
    const rng = mulberry32(11);
    let state = createInitialMatch(DEFAULT_RULES);
    const dealt = applyAction(state, { t: 'deal' }, rng);
    if (!dealt.ok) throw new Error('deal 失败');
    state = dealt.state;
    const view = viewOf(state, 0);
    const ctx = makeCtx(view.level, view.rules);
    const opts = leadOptions(view.hand, ctx);
    const moves = opts.slice(0, 3).map((o) => ({ cards: o.cards, interpId: 0, pass: false }));
    const idx = rolloutBest(view, moves, mulberry32(13), { samples: 2, maxSteps: 60 });
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(moves.length);
  });
});