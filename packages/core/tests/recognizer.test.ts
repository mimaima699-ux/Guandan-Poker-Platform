import { describe, expect, it } from 'vitest';
import { makeCard, HEART, type Card } from '../src/card';
import { interpret, makeCtx } from '../src/recognizer';
import { DEFAULT_RULES } from '../src/rules';
import type { Shape } from '../src/shape';

const C = (code: number, suit = 0, copy = 0): Card =>
  makeCard(code as Parameters<typeof makeCard>[0], suit as Parameters<typeof makeCard>[1], copy as 0 | 1);
const W = (level: number, copy: 0 | 1 = 0): Card => makeCard(level, HEART, copy); // 逢人配

/** 只取解释的形状列表 */
const shapes = (cards: Card[], level: number, rules = DEFAULT_RULES): Shape[] =>
  interpret(cards, makeCtx(level, rules)).map((i) => i.shape);

describe('识别器黄金用例', () => {
  it('基础牌型', () => {
    expect(shapes([C(9)], 5)).toEqual([{ k: 'single', key: 6 }]);
    expect(shapes([C(9, 1), C(9, 2)], 5)).toEqual([{ k: 'pair', key: 6 }]);
    expect(shapes([C(9), C(9, 1), C(9, 2)], 5)).toEqual([{ k: 'trio', key: 6 }]);
    expect(shapes([C(9), C(9, 1), C(7), C(7, 1)], 5)).toEqual([]); // 2+2 不是牌型
    expect(shapes([C(9), C(9, 1), C(9, 2), C(7), C(7, 1)], 5)).toEqual([{ k: 'trioPlusPair', key: 6 }]);
    expect(shapes([C(9), C(9, 1), C(9, 2), C(9, 3)], 5)).toEqual([{ k: 'bomb', key: 6, size: 4 }]);
  });

  it('级牌与王', () => {
    expect(shapes([C(5, 2), C(5, 1)], 5)).toEqual([{ k: 'pair', key: 13 }]);
    expect(shapes([C(15), C(15, 0, 1)], 5)).toEqual([{ k: 'pair', key: 14 }]); // 双小王算对子
    expect(shapes([C(15), C(16)], 5)).toEqual([]); // 大小王不成对
    expect(shapes([C(15), C(15, 0, 1), C(16), C(16, 0, 1)], 5)).toEqual([{ k: 'jokerBomb' }]);
    expect(shapes([C(15), C(15, 0, 1), C(16)], 5)).toEqual([]);
  });

  it('逢人配基础', () => {
    expect(shapes([W(5)], 5)).toEqual([{ k: 'single', key: 13 }]); // 当级牌单张
    expect(shapes([W(5), C(9)], 5)).toEqual([{ k: 'pair', key: 6 }]);
    expect(shapes([W(5), W(5, 1)], 5)).toEqual([{ k: 'pair', key: 13 }]); // 双配当级牌对
    expect(shapes([W(5), C(9), C(9, 1)], 5)).toEqual([{ k: 'trio', key: 6 }]);
    expect(shapes([W(5), C(9), C(9, 1), C(9, 2)], 5)).toEqual([{ k: 'bomb', key: 6, size: 4 }]);
    expect(shapes([W(5), C(7), C(7, 1), C(7, 2), C(7, 3)], 5)).toEqual([{ k: 'bomb', key: 4, size: 5 }]);
    // 3 张自然级牌 + 2 张配：五张级牌炸，或 555 带双配对（配可当任意对子）
    expect(shapes([C(5, 2), C(5, 1), C(5, 0), W(5), W(5, 1)], 5)).toEqual([
      { k: 'bomb', key: 13, size: 5 },
      { k: 'trioPlusPair', key: 13 },
    ]);
  });

  it('三带二多义解释：999带88 与 888带99', () => {
    const r = shapes([W(5), C(9), C(9, 1), C(8), C(8, 1)], 5);
    expect(r).toEqual([
      { k: 'trioPlusPair', key: 6 }, // 999 带 88（强解释在前）
      { k: 'trioPlusPair', key: 5 }, // 888 带 99
    ]);
  });

  it('炸弹与三带二歧义', () => {
    const r = shapes([C(7), C(7, 1), C(7, 2), W(5), W(5, 1)], 5);
    expect(r).toEqual([
      { k: 'bomb', key: 4, size: 5 }, // 77777 五张炸
      { k: 'trioPlusPair', key: 4 }, // 777 带任意对
    ]);
  });

  it('顺子：A2345 特例与级牌剔除', () => {
    expect(shapes([C(14, 0), C(2, 1), C(3, 0), C(4, 2), C(5, 1)], 8)).toEqual([{ k: 'straight', key: 2 }]);
    expect(shapes([C(14), C(2), C(3), C(4), C(5)], 2)).toEqual([]); // 打 2 无 A2345
    expect(shapes([C(3), C(4), C(5), C(6), C(7)], 5)).toEqual([]); // 顺子含级牌 5
    expect(shapes([W(5), C(3), C(4), C(6), C(7)], 5)).toEqual([]); // R8：配不可替成级牌补顺
    expect(shapes([W(5), C(6, 0), C(7, 1), C(8, 0), C(9, 2)], 5)).toEqual([{ k: 'straight', key: 7 }]); // 配当 10
  });

  it('同花顺与顺子双解释', () => {
    const allD = [C(3, 0), C(4, 0), C(5, 0), C(6, 0), C(7, 0)];
    expect(shapes(allD, 8)).toEqual([
      { k: 'flushStraight', key: 4, suit: 0 }, // tier 2 在前
      { k: 'straight', key: 4 },
    ]);
    expect(shapes([C(3, 0), C(4, 1), C(5, 0), C(6, 0), C(7, 0)], 8)).toEqual([{ k: 'straight', key: 4 }]);
    // 逢人配补同花顺
    expect(shapes([W(5), C(6, 0), C(7, 0), C(8, 0), C(9, 0)], 5)).toEqual([
      { k: 'flushStraight', key: 7, suit: 0 },
      { k: 'straight', key: 7 },
    ]);
  });

  it('三连对与钢板', () => {
    expect(shapes([C(3), C(3, 1), C(4), C(4, 1), C(5), C(5, 1)], 8)).toEqual([{ k: 'trioRun', key: 2 }]);
    expect(shapes([C(3), C(3, 1), C(3, 2), C(4), C(4, 1), C(4, 2)], 8)).toEqual([
      { k: 'steel', key: 1, len: 2, kickers: 0 },
    ]);
    // 裸钢板禁止时
    expect(
      shapes([C(3), C(3, 1), C(3, 2), C(4), C(4, 1), C(4, 2)], 8, { ...DEFAULT_RULES, allowBareSteel: false }),
    ).toEqual([]);
    // 带对钢板
    expect(
      shapes([C(3), C(3, 1), C(3, 2), C(4), C(4, 1), C(4, 2), C(9), C(9, 1), C(10), C(10, 1)], 8),
    ).toEqual([{ k: 'steel', key: 1, len: 2, kickers: 2 }]);
    // 钢板窗口含级牌则非法
    expect(shapes([C(4), C(4, 1), C(4, 2), C(5), C(5, 1), C(5, 2)], 5)).toEqual([]);
    // 三连对窗口含级牌则非法
    expect(shapes([C(4), C(4, 1), C(5), C(5, 1), C(6), C(6, 1)], 5)).toEqual([]);
  });

  it('带对不可为王对（默认）', () => {
    expect(shapes([C(7), C(7, 1), C(7, 2), C(15), C(15, 0, 1)], 5)).toEqual([]);
    expect(
      shapes([C(7), C(7, 1), C(7, 2), C(15), C(15, 0, 1)], 5, {
        ...DEFAULT_RULES,
        allowJokerAttachment: true,
      }),
    ).toEqual([{ k: 'trioPlusPair', key: 4 }]);
  });

  it('逢人配补钢板带对', () => {
    // 333 444 + (9+配成对) + (10,10 成对)
    expect(shapes([C(3), C(3, 1), C(3, 2), C(4), C(4, 1), C(4, 2), C(9), W(5), C(10), C(10, 1)], 5)).toEqual([
      { k: 'steel', key: 1, len: 2, kickers: 2 },
    ]);
  });
});
