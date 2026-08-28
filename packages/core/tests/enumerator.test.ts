import { describe, expect, it } from 'vitest';
import { makeCard, HEART, type Card } from '../src/card';
import { makeCtx } from '../src/recognizer';
import { beatOptions, canBeat, leadOptions } from '../src/enumerator';
import { beats, shapeSig, type Shape } from '../src/shape';

const C = (code: number, suit = 0, copy = 0): Card =>
  makeCard(code as Parameters<typeof makeCard>[0], suit as Parameters<typeof makeCard>[1], copy as 0 | 1);
const W = (level: number, copy: 0 | 1 = 0): Card => makeCard(level, HEART, copy);

const sig = (s: Shape): string => shapeSig(s);

describe('候选枚举器', () => {
  it('leadOptions 覆盖各牌型且选牌均为手牌子集', () => {
    const level = 8;
    const hand = [
      C(3), C(3, 1), C(4), C(5), C(6), C(7),
      C(9), C(9, 1), C(9, 2), C(11), C(11, 1), C(15), C(16),
    ];
    const opts = leadOptions(hand, makeCtx(level));
    const kinds = new Set(opts.flatMap((o) => o.interps.map((i) => i.shape.k)));
    expect(kinds.has('single')).toBe(true);
    expect(kinds.has('pair')).toBe(true);
    expect(kinds.has('trio')).toBe(true);
    expect(kinds.has('straight')).toBe(true);
    expect(kinds.has('trioPlusPair')).toBe(true);
    for (const o of opts) {
      const set = new Set(o.cards);
      expect(set.size).toBe(o.cards.length); // 无重复物理牌
      for (const c of o.cards) expect(hand).toContain(c);
      expect(o.interps.length).toBeGreaterThan(0);
    }
  });

  it('beatOptions：同型压制与升维', () => {
    const level = 8;
    // 注意花色混合，避免意外组成同花顺
    const hand = [C(3, 0), C(3, 1), C(9, 0), C(9, 1), C(9, 2), C(9, 3), C(6, 1), C(7, 2), C(8, 1), C(5, 2), C(4, 1)];
    const ctx = makeCtx(level);
    // 目标：对 5（key 2）
    const pairOf5: Shape = { k: 'pair', key: 2 };
    const beatsPair = beatOptions(hand, pairOf5, ctx);
    expect(beatsPair.length).toBeGreaterThan(0);
    // 99 对必在候选中
    expect(beatsPair.some((o) => o.interps.some((i) => sig(i.shape) === '0|6|pair|||'))).toBe(true);
    // 每个候选至少有一个解释真的压过目标
    for (const o of beatsPair) {
      expect(o.interps.some((i) => i.shape.k === 'pair' && i.shape.key! > 2 || i.shape.k !== 'pair')).toBe(true);
    }
    // 目标：4 张 9 炸（同张数点数无法压，只能升维——手里没有更大炸）
    const bomb9: Shape = { k: 'bomb', key: 6, size: 4 };
    expect(canBeat(hand, bomb9, ctx)).toBe(false);
    // 加一张王炸进手牌则可压
    const hand2 = [...hand, C(15), C(15, 0, 1), C(16), C(16, 0, 1)];
    expect(canBeat(hand2, bomb9, ctx)).toBe(true);
    // 天王炸无敌
    const jb: Shape = { k: 'jokerBomb' };
    expect(canBeat(hand2, jb, ctx)).toBe(false);
  });

  it('beatOptions：顺子窗口只取更高的', () => {
    const level = 13; // 级数不落在 3..J 的顺子窗口里
    // 混花色，避免同花顺干扰
    const hand = [C(3, 0), C(4, 1), C(5, 0), C(6, 2), C(7, 0), C(8, 1), C(9, 0), C(10, 2), C(11, 0)];
    const ctx = makeCtx(level);
    const target: Shape = { k: 'straight', key: 4 }; // 34567
    const opts = beatOptions(hand, target, ctx);
    const beating = opts.flatMap((o) => o.interps.map((i) => i.shape)).filter((s) => beats(s, target));
    expect(beating.length).toBeGreaterThan(0);
    for (const s of beating) expect((s as { key?: number }).key!).toBeGreaterThan(4);
  });

  it('逢人配参与枚举', () => {
    const level = 5;
    const hand = [W(5), C(6), C(7), C(8), C(9), C(2), C(2, 1)];
    const ctx = makeCtx(level);
    const opts = leadOptions(hand, ctx);
    // 配当 10 组成 6789T 顺子
    expect(opts.some((o) => o.interps.some((i) => sig(i.shape) === '0|7|straight|||'))).toBe(true);
    // 配+2 组成对 2
    expect(opts.some((o) => o.interps.some((i) => sig(i.shape) === '0|-1|pair|||'))).toBe(true);
  });
});
