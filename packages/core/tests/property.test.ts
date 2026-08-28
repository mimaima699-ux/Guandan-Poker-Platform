import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FULL_DECK, HEART, makeCard, type Card } from '../src/card';
import { interpret, makeCtx } from '../src/recognizer';
import { beatOptions, leadOptions } from '../src/enumerator';
import { beats } from '../src/shape';
import { crossCheck } from '../src/devBruteforce';
import { DEFAULT_RULES } from '../src/rules';
import { dealHands } from '../src/deck';
import { mulberry32 } from '../src/rng';

describe('属性测试：模板法 vs 暴力法 对拍', () => {
  it('随机选牌的完整解释交叉验证（无遗漏、无幻觉）', () => {
    const levelArb = fc.integer({ min: 2, max: 14 });
    const selArb = fc.uniqueArray(fc.nat(107), { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(levelArb, selArb, (level, idxs) => {
        const base = idxs.map((i) => FULL_DECK[i]);
        const ctx = makeCtx(level, DEFAULT_RULES);
        const variants: Card[][] = [base];
        const w0 = makeCard(level, HEART, 0);
        const w1 = makeCard(level, HEART, 1);
        if (!base.includes(w0)) variants.push([...base, w0]);
        if (!base.includes(w1)) variants.push([...base, w1]);
        variants.push([...base.filter((c) => c !== w0 && c !== w1), w0, w1]);
        for (const v of variants) {
          const r = crossCheck(v, ctx);
          if (!r.ok) {
            console.error('对拍失败 level=', level, 'cards=', v.map((c) => `${c}`), r.detail);
            return false;
          }
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });

  it('beats 反对称性与自反性', () => {
    const shapeArb = fc
      .integer({ min: 2, max: 14 })
      .chain((level) =>
        fc.uniqueArray(fc.nat(107), { minLength: 1, maxLength: 8 }).map((idxs) => ({
          level,
          cards: idxs.map((i) => FULL_DECK[i]),
        })),
      );
    fc.assert(
      fc.property(shapeArb, shapeArb, (a, b) => {
        const sa = interpret(a.cards, makeCtx(a.level));
        const sb = interpret(b.cards, makeCtx(b.level));
        for (const x of sa) {
          expect(beats(x.shape, x.shape)).toBe(false); // 不自反
          for (const y of sb) {
            expect(beats(x.shape, y.shape) && beats(y.shape, x.shape)).toBe(false); // 反对称
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('leadOptions 往返一致且 beatOptions 必须真的压过目标', () => {
    const arb = fc.integer({ min: 2, max: 14 }).chain((level) =>
      fc.uniqueArray(fc.nat(107), { minLength: 10, maxLength: 14 }).map((idxs) => ({
        level,
        hand: idxs.map((i) => FULL_DECK[i]),
      })),
    );
    fc.assert(
      fc.property(arb, ({ level, hand }) => {
        const ctx = makeCtx(level);
        const opts = leadOptions(hand, ctx);
        expect(opts.length).toBeGreaterThan(0);
        for (const o of opts) {
          // 每个候选的首解释能被 interpret 复原（往返一致）
          const re = interpret(o.cards, ctx).map((i) => i.shape);
          expect(re.some((s) => s.k === o.interps[0].shape.k && (s as { key?: number }).key === (o.interps[0].shape as { key?: number }).key)).toBe(true);
          const set = new Set(o.cards);
          expect(set.size).toBe(o.cards.length);
        }
        // 用首个候选当目标，验证 beatOptions 语义
        const target = opts[0].interps[0].shape;
        for (const o of beatOptions(hand, target, ctx)) {
          expect(o.interps.some((i) => beats(i.shape, target))).toBe(true);
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('性能：27 张手牌的 beatOptions < 50ms', () => {
    const rng = mulberry32(20260826);
    for (let i = 0; i < 20; i++) {
      const hands = dealHands(rng, 5);
      const hand = hands[0];
      const ctx = makeCtx(5);
      const opts = leadOptions(hand, ctx);
      expect(opts.length).toBeGreaterThan(0);
      const t0 = performance.now();
      beatOptions(hand, opts[0].interps[0].shape, ctx);
      const dt = performance.now() - t0;
      expect(dt).toBeLessThan(50);
    }
  });
});
