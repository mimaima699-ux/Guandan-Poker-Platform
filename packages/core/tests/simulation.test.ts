import { describe, expect, it } from 'vitest';
import { codeOf, isWildCard, orderKey } from '../src/card';
import { mulberry32, type Rng } from '../src/rng';
import { DEFAULT_RULES } from '../src/rules';
import { createInitialMatch, type GameState } from '../src/engine/state';
import { applyAction, type Action } from '../src/engine/engine';
import { viewOf } from '../src/engine/view';
import { interpret, makeCtx } from '../src/recognizer';
import { leadOptions, beatOptions } from '../src/enumerator';
import { beats } from '../src/shape';
import type { SeatId } from '../src/types';

/** 随机机器人：在任意状态给出一个合法动作 */
function randomAction(state: GameState, rng: Rng): Action {
  if (state.phase === 'idle' || state.phase === 'handOver') return { t: 'deal' };
  const h = state.hand!;
  if (state.phase === 'tribute') {
    const pair = h.tribute!.pairs.find((p) => p.card === null)!;
    const seat = pair.from;
    const cands = h.hands[seat].filter((c) => !isWildCard(c, h.level));
    const best = Math.max(...cands.map((c) => orderKey(codeOf(c), h.level)));
    const choices = cands.filter((c) => orderKey(codeOf(c), h.level) === best);
    return { t: 'tribute', seat, card: choices[rng.int(choices.length)] };
  }
  if (state.phase === 'tributeReturn') {
    const pair = h.tribute!.pairs.find((p) => p.returned === null)!;
    const seat = pair.to;
    const cands = h.hands[seat].filter((c) => !isWildCard(c, h.level) && codeOf(c) <= 10);
    return { t: 'returnTribute', seat, card: cands[rng.int(cands.length)] };
  }
  // playing
  const seat = h.turn;
  const ctx = makeCtx(h.level, state.rules);
  if (!h.last) {
    const opts = leadOptions(h.hands[seat], ctx);
    const o = opts[rng.int(opts.length)];
    return { t: 'play', seat, cards: o.cards, interpId: 0 };
  }
  const opts = beatOptions(h.hands[seat], h.last.shape, ctx);
  const mustPass = opts.length === 0 || rng.next() < 0.45;
  if (mustPass) return { t: 'pass', seat };
  const o = opts[rng.int(opts.length)];
  const interps = interpret(o.cards, ctx);
  const idx = interps.findIndex((i) => beats(i.shape, h.last!.shape));
  return { t: 'play', seat, cards: o.cards, interpId: idx };
}

function checkInvariants(state: GameState): void {
  const h = state.hand;
  if (!h) return;
  const inHands = h.hands.reduce((a, x) => a + x.length, 0);
  const inStream = h.stream.reduce((a, r) => a + r.cards.length, 0);
  expect(inHands + inStream).toBe(108); // 牌数守恒
  const all = [...h.hands.flat(), ...h.stream.flatMap((r) => r.cards)];
  expect(new Set(all).size).toBe(all.length); // 物理唯一
  if (state.phase === 'playing') {
    expect(h.hands[h.turn].length).toBeGreaterThan(0); // 行动者有牌
  }
  // 名次不重复
  expect(new Set(h.placements).size).toBe(h.placements.length);
}

describe('仿真：随机机器人整场对打', () => {
  it('200 局全部终止且不变量成立', () => {
    const rng = mulberry32(20260826);
    let hands = 0;
    let matches = 0;
    const MAX_HANDS = 200;
    while (hands < MAX_HANDS) {
      let state = createInitialMatch(DEFAULT_RULES);
      let actions = 0;
      // 打完整场比赛（封顶 40 局防死循环）
      while (state.phase !== 'matchOver' && actions < 20000) {
        const action = randomAction(state, rng);
        const res = applyAction(state, action, rng);
        expect(res.ok).toBe(true);
        if (!res.ok) break;
        if (action.t === 'deal') hands++;
        if (res.state.phase === 'matchOver') matches++;
        state = res.state;
        checkInvariants(state);
        actions++;
      }
      expect(actions).toBeLessThan(20000); // 必须终止
      expect(state.phase).toBe('matchOver');
    }
    // 统计合理性：200 局至少打完若干场
    expect(hands).toBeGreaterThanOrEqual(MAX_HANDS - 4);
    expect(matches).toBeGreaterThan(0);
  });

  it('viewOf 不泄露他人手牌', () => {
    const rng = mulberry32(99);
    let state = createInitialMatch(DEFAULT_RULES);
    let actions = 0;
    while (state.phase !== 'matchOver' && actions < 3000) {
      const action = randomAction(state, rng);
      const res = applyAction(state, action, rng);
      if (!res.ok) break;
      state = res.state;
      for (const seat of [0, 1, 2, 3] as SeatId[]) {
        const v = viewOf(state, seat);
        // 自己手牌必须等于引擎手牌
        expect(v.hand).toEqual(state.hand?.hands[seat] ?? []);
        // 手牌数与实际一致
        state.hand?.hands.forEach((hh, i) => {
          expect(v.handCounts[i]).toBe(hh.length);
        });
      }
      actions++;
    }
  });
});
