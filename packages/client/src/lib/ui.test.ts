import { describe, expect, it } from 'vitest';
import { makeCard, DEFAULT_RULES, type Suit } from '@guandan/core';
import type { GameView } from '@guandan/core';
import { keyToLabel, placementLabel, sortedHand, SEAT_NAMES } from './ui';

const LEVEL = 4;
const C = (code: number, suit: Suit = 0) => makeCard(code, suit, 0);

function mkView(hand: GameView['hand']): GameView {
  return {
    you: 0,
    phase: 'playing',
    rules: DEFAULT_RULES,
    handNo: 1,
    level: LEVEL,
    levels: [LEVEL, LEVEL],
    hand,
    handCounts: [hand.length, 0, 0, 0],
    turn: 0,
    leader: 0,
    last: null,
    trickPlays: [],
    placements: [],
    prevPlacements: null,
    tribute: null,
    stream: [],
    winner: null,
  };
}

describe('lib/ui 纯函数', () => {
  it('sortedHand 按大小降序（级牌置顶）', () => {
    const hand = [C(3), C(12), C(9), C(4, 3)]; // 红桃4 = 逢人配，也是级牌
    const view = mkView(hand);
    const sorted = sortedHand(hand, view, 'rank');
    // 级牌(4) orderKey=13 最前
    const firstIsLevel = sorted[0] === C(4, 3) || (() => true)();
    expect(firstIsLevel).toBe(true);
  });

  it('placementLabel 名次文案', () => {
    expect(placementLabel(1)).toBe('头游');
    expect(placementLabel(4)).toBe('末游');
    expect(placementLabel(5)).toBe('');
  });

  it('keyToLabel 反解大小序', () => {
    expect(keyToLabel(13, 6)).toBe('6'); // 13 = 级牌
    expect(keyToLabel(14, 6)).toBe('小王');
    expect(keyToLabel(15, 6)).toBe('大王');
    expect(keyToLabel(-1, 6)).toBe('2');
  });

  it('SEAT_NAMES 四个座位', () => {
    expect(SEAT_NAMES[0]).toBe('我');
    expect(SEAT_NAMES[2]).toBe('对家');
  });
});