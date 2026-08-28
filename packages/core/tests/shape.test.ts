import { describe, expect, it } from 'vitest';
import { runWindows, straightWindows } from '../src/rank';
import { beats, type Shape } from '../src/shape';

const bomb = (key: number, size: number): Shape => ({ k: 'bomb', key, size });
const flush = (key: number): Shape => ({ k: 'flushStraight', key, suit: 0 });
const pair = (key: number): Shape => ({ k: 'pair', key });

describe('连序窗口', () => {
  it('打 2 时无 A2345，顺子窗口 8 个', () => {
    const wins = straightWindows(2);
    expect(wins).toHaveLength(8); // 34567 … TJQA
    expect(wins.some((w) => w.ranks.includes(2))).toBe(false);
  });

  it('打 6 时含 6 的窗口全部剔除', () => {
    const wins = straightWindows(6);
    // 起点 s 使窗口含 6：s∈{2..6}∩{3..10} = {3,4,5,6} 被剔除，剩 7,8,9,10 + A2345
    expect(wins).toHaveLength(5);
    expect(wins.some((w) => w.ranks.includes(6))).toBe(false);
  });

  it('打 A 时 A2345 与 TJQA 均剔除', () => {
    const wins = straightWindows(14);
    expect(wins).toHaveLength(7); // 34567…9TJQK
    expect(wins.some((w) => w.ranks.includes(14))).toBe(false);
  });

  it('三连对窗口：打 5 时不含 5', () => {
    const wins = runWindows(5, 3);
    expect(wins).toHaveLength(7); // 678 … QKA
    expect(wins.some((w) => w.ranks.includes(5))).toBe(false);
  });
});

describe('火力比较 beats', () => {
  it('火力序：天王炸 > 8炸 > 7炸 > 6炸 > 同花顺 > 5炸 > 4炸 > 普通', () => {
    expect(beats(bomb(0, 6), flush(11))).toBe(true); // 6炸 > 同花顺
    expect(beats(flush(2), bomb(11, 5))).toBe(true); // 同花顺 > 5炸
    expect(beats(bomb(11, 5), bomb(0, 4))).toBe(true); // 5炸 > 4炸
    expect(beats(bomb(0, 8), bomb(15, 6))).toBe(true); // 张数多大者大
    expect(beats({ k: 'jokerBomb' }, bomb(15, 8))).toBe(true); // 天王炸最大
    expect(beats(bomb(15, 8), { k: 'jokerBomb' })).toBe(false);
  });

  it('炸弹同张数比点数，级牌炸弹 > A 炸弹', () => {
    expect(beats(bomb(13, 4), bomb(11, 4))).toBe(true); // 级牌炸(key13) > A炸(key11)
    expect(beats(bomb(11, 4), bomb(13, 4))).toBe(false);
  });

  it('普通牌型须同型同张数', () => {
    expect(beats(pair(5), pair(3))).toBe(true);
    expect(beats(pair(5), pair(5))).toBe(false); // 同点不可再压
    expect(beats({ k: 'straight', key: 4 }, { k: 'straight', key: 2 })).toBe(true); // 34567 > A2345
    expect(beats({ k: 'trioRun', key: 5 }, { k: 'trioRun', key: 4 })).toBe(true);
    // 三连对与裸钢板同为 6 张但不同型，不可互压
    expect(beats({ k: 'trioRun', key: 5 }, { k: 'steel', key: 4, len: 2, kickers: 0 })).toBe(false);
    // 裸钢板与带对钢板张数不同
    expect(beats({ k: 'steel', key: 5, len: 2, kickers: 2 }, { k: 'steel', key: 4, len: 2, kickers: 0 })).toBe(false);
    // 同为带对钢板比 top
    expect(beats({ k: 'steel', key: 5, len: 2, kickers: 2 }, { k: 'steel', key: 4, len: 2, kickers: 2 })).toBe(true);
  });

  it('三带二只比三张点数', () => {
    expect(beats({ k: 'trioPlusPair', key: 6 }, { k: 'trioPlusPair', key: 5 })).toBe(true);
  });
});
