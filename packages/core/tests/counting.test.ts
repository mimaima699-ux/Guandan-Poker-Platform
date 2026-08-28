import { describe, expect, it } from 'vitest';
import { makeCard, orderKey } from '../src/card';
import { bombIsTop, countHidden, wouldWin, type HiddenInfo } from '../src/ai/counting';

const LEVEL = 4;

function mkHidden(patch: Record<number, number>): HiddenInfo {
  const remaining = new Int16Array(17);
  for (const [code, n] of Object.entries(patch)) remaining[Number(code)] = n;
  return { remaining, bigJokers: remaining[16], smallJokers: remaining[15] };
}

describe('记牌器 countHidden', () => {
  it('全量守恒：空手牌 + 无出牌 = 满牌堆', () => {
    const h = countHidden([], []);
    expect(h.remaining[2]).toBe(8);
    expect(h.remaining[14]).toBe(8);
    expect(h.smallJokers).toBe(2);
    expect(h.bigJokers).toBe(2);
  });

  it('我手里的牌与已打出的牌被正确扣除', () => {
    const mine = [makeCard(3, 0, 0), makeCard(16, 0, 0)];
    const played = [makeCard(3, 1, 1), makeCard(10, 2, 0)];
    const h = countHidden(mine, played);
    expect(h.remaining[3]).toBe(6); // 8 - 我1 - 打出1
    expect(h.remaining[10]).toBe(7);
    expect(h.bigJokers).toBe(1); // 我持 1 张大王
    expect(h.smallJokers).toBe(2);
  });
});

describe('炸弹是否还能被压 bombIsTop', () => {
  it('外面没有更大的炸 → 顶炸', () => {
    expect(bombIsTop(4, orderKey(7, LEVEL), mkHidden({}), LEVEL)).toBe(true);
  });

  it('外面有同点 4 张（另一副同级牌）→ 仍是顶炸（同点炸不能压自己）', () => {
    expect(bombIsTop(4, orderKey(7, LEVEL), mkHidden({ 7: 4 }), LEVEL)).toBe(true);
  });

  it('外面有更高点的 4 炸 → 不顶', () => {
    expect(bombIsTop(4, orderKey(7, LEVEL), mkHidden({ 9: 4 }), LEVEL)).toBe(false);
  });

  it('外面有 5 张同点（更大的炸）→ 不顶', () => {
    expect(bombIsTop(4, orderKey(7, LEVEL), mkHidden({ 5: 5 }), LEVEL)).toBe(false);
  });

  it('四个王都在外面（可能天王炸）→ 不顶', () => {
    expect(bombIsTop(4, orderKey(7, LEVEL), mkHidden({ 15: 2, 16: 2 }), LEVEL)).toBe(false);
  });
});

describe('这一手还会不会被压 wouldWin', () => {
  it('单张：外面没有更大的 → 稳', () => {
    expect(wouldWin({ k: 'single', key: orderKey(14, LEVEL) }, mkHidden({}), LEVEL)).toBe(true);
  });
  it('单张：外面还有大王/更大的牌 → 会被压', () => {
    expect(wouldWin({ k: 'single', key: orderKey(14, LEVEL) }, mkHidden({ 16: 1 }), LEVEL)).toBe(false);
  });
  it('对子：外面还有同点两张更大的 → 会被压', () => {
    expect(wouldWin({ k: 'pair', key: orderKey(9, LEVEL) }, mkHidden({ 12: 2 }), LEVEL)).toBe(false);
  });
  it('对子：外面仅有更大的 1 张 → 稳（凑不成对）', () => {
    expect(wouldWin({ k: 'pair', key: orderKey(9, LEVEL) }, mkHidden({ 12: 1 }), LEVEL)).toBe(true);
  });
  it('三张：数量不足 → 稳', () => {
    expect(wouldWin({ k: 'trio', key: orderKey(5, LEVEL) }, mkHidden({ 10: 2 }), LEVEL)).toBe(true);
  });
  it('天王炸 → 恒稳', () => {
    expect(wouldWin({ k: 'jokerBomb' }, mkHidden({ 16: 2 }), LEVEL)).toBe(true);
  });
  it('顺子不建模 → null', () => {
    expect(wouldWin({ k: 'straight', key: orderKey(9, LEVEL) }, mkHidden({}), LEVEL)).toBeNull();
  });
});