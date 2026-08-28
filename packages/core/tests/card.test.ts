import { describe, expect, it } from 'vitest';
import {
  FULL_DECK,
  codeOf,
  copyOf,
  isWildCard,
  makeCard,
  orderKey,
  sortHand,
  suitOf,
  HEART,
} from '../src/card';

describe('牌编码', () => {
  it('完整牌堆 108 张且物理唯一', () => {
    expect(FULL_DECK).toHaveLength(108);
    expect(new Set(FULL_DECK).size).toBe(108);
  });

  it('编码往返一致', () => {
    for (const c of FULL_DECK) {
      expect(makeCard(codeOf(c), suitOf(c), copyOf(c))).toBe(c);
    }
  });

  it('orderKey：级牌介于 A 与小王之间', () => {
    // 打 5
    expect(orderKey(2, 5)).toBe(-1); // 非级牌的 2 最小
    expect(orderKey(3, 5)).toBe(0);
    expect(orderKey(4, 5)).toBe(1);
    expect(orderKey(5, 5)).toBe(13); // 级牌
    expect(orderKey(6, 5)).toBe(3);
    expect(orderKey(14, 5)).toBe(11); // A
    expect(orderKey(15, 5)).toBe(14); // 小王
    expect(orderKey(16, 5)).toBe(15); // 大王
    // 打 2：2 是级牌
    expect(orderKey(2, 2)).toBe(13);
    expect(orderKey(3, 2)).toBe(0);
    // 打 A
    expect(orderKey(14, 14)).toBe(13);
    expect(orderKey(13, 14)).toBe(10);
  });

  it('红桃级牌为逢人配', () => {
    expect(isWildCard(makeCard(5, HEART, 0), 5)).toBe(true);
    expect(isWildCard(makeCard(5, HEART, 1), 5)).toBe(true);
    expect(isWildCard(makeCard(5, 2, 0), 5)).toBe(false); // 黑桃级牌是普通级牌
    expect(isWildCard(makeCard(7, HEART, 0), 5)).toBe(false);
  });

  it('手牌排序：级牌置顶、降序', () => {
    const cards = [makeCard(3, 0, 0), makeCard(14, 1, 0), makeCard(5, 2, 0), makeCard(15, 0, 0)];
    const sorted = sortHand(cards, 5);
    expect(codeOf(sorted[0])).toBe(15); // 小王
    expect(codeOf(sorted[1])).toBe(5); // 级牌 5
    expect(codeOf(sorted[2])).toBe(14); // A
    expect(codeOf(sorted[3])).toBe(3);
  });
});
