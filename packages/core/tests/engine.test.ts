import { describe, expect, it } from 'vitest';
import { makeCard, type Card } from '../src/card';
import { DEFAULT_RULES } from '../src/rules';
import { mulberry32, type Rng } from '../src/rng';
import { createInitialMatch } from '../src/engine/state';
import {
  applyAction,
  beginHand,
  returnableCards,
  tributableCards,
  type Action,
} from '../src/engine/engine';
import { viewOf } from '../src/engine/view';
import type { GameState } from '../src/engine/state';
import type { SeatId } from '../src/types';

const C = (code: number, suit = 0, copy = 0): Card =>
  makeCard(code as Parameters<typeof makeCard>[0], suit as Parameters<typeof makeCard>[1], copy as 0 | 1);
const rng = (): Rng => mulberry32(42);

function applyOk(s: GameState, a: Action, r: Rng = rng()): GameState {
  const res = applyAction(s, a, r);
  if (!res.ok) throw new Error(`动作失败 ${JSON.stringify(a)}: ${res.error}`);
  return res.state;
}

function craftMatch(hands: Card[][], level: number, leader: SeatId, levels?: [number, number]): GameState {
  return {
    phase: 'playing',
    rules: DEFAULT_RULES,
    match: { levels: levels ?? [level, level], handNo: 1, prevPlacements: null, winner: null },
    hand: {
      level,
      hands,
      leader,
      turn: leader,
      last: null,
      passes: 0,
      placements: [],
      currentTrick: [],
      stream: [],
      tribute: null,
    },
  };
}

describe('引擎：走牌与接风', () => {
  it('无人压牌且赢家已离场 → 接风给对家', () => {
    // 0: 大王一张（出完即头游）；1: 3；2: K；3: 5
    const s0 = craftMatch([[C(16)], [C(3)], [C(13)], [C(5)]], 8, 0);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(16)], interpId: 0 });
    expect(s.hand!.placements).toEqual([0]);
    s = applyOk(s, { t: 'pass', seat: 1 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    // 接风：出牌权给 0 的对家 2
    expect(s.hand!.leader).toBe(2);
    expect(s.hand!.last).toBeNull();
    expect(s.hand!.currentTrick).toHaveLength(0);
    // 2 领出 K（出完，二游）
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(13)], interpId: 0 });
    expect(s.hand!.placements).toEqual([0, 2]);
    // 双下已定但需三人出完：接风给 2 的对家 0（已离场）→ 顺时针下一位 1
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'pass', seat: 1 });
    expect(s.hand!.leader).toBe(1);
    // 1 出 3（三游）→ 本局结束，末游 3
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(3)], interpId: 0 });
    expect(s.phase).toBe('handOver');
    expect(s.hand!.placements).toEqual([0, 2, 1, 3]);
    // 双下 +3：8 级局 → 11
    expect(s.match.levels[0]).toBe(11);
    expect(s.match.levels[1]).toBe(8);
    expect(s.match.prevPlacements).toEqual([0, 2, 1, 3]);
  });

  it('头游+三游升 2 级', () => {
    // 目标名次 [0,1,2,3]：0 头游、1 二游、2 三游、3 末游 → 0 队 +2
    const s0 = craftMatch([[C(16)], [C(15), C(5)], [C(9), C(3)], [C(7), C(6)]], 8, 0);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(16)], interpId: 0 }); // 头游
    s = applyOk(s, { t: 'pass', seat: 1 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    expect(s.hand!.leader).toBe(2); // 接风对家
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(3)], interpId: 0 });
    s = applyOk(s, { t: 'play', seat: 3, cards: [C(7)], interpId: 0 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(15)], interpId: 0 }); // 小王压 7
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(5)], interpId: 0 }); // 二游
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(9)], interpId: 0 }); // 三游 → 本局结束
    expect(s.phase).toBe('handOver');
    expect(s.hand!.placements).toEqual([0, 1, 2, 3]);
    expect(s.match.levels[0]).toBe(10); // 8 级 +2
    expect(s.match.levels[1]).toBe(8);
  });

  it('头游+末游升 1 级', () => {
    // 目标名次 [0,1,3,2]：2 是末游（剩牌未出）→ 0 队 +1
    const s0 = craftMatch([[C(16)], [C(15), C(5)], [C(9), C(3)], [C(7), C(6)]], 8, 0);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(16)], interpId: 0 });
    s = applyOk(s, { t: 'pass', seat: 1 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(3)], interpId: 0 });
    s = applyOk(s, { t: 'play', seat: 3, cards: [C(7)], interpId: 0 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(15)], interpId: 0 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(5)], interpId: 0 }); // 二游
    s = applyOk(s, { t: 'pass', seat: 2 }); // 2 有 9 可压但选择过
    s = applyOk(s, { t: 'play', seat: 3, cards: [C(6)], interpId: 0 }); // 三游 → 结束，2 末游
    expect(s.phase).toBe('handOver');
    expect(s.hand!.placements).toEqual([0, 1, 3, 2]);
    expect(s.match.levels[0]).toBe(9); // 8 级 +1
  });
});

describe('引擎：进贡体系', () => {
  it('单贡：贡最大牌、还贡≤10、收贡者先出', () => {
    const s: GameState = {
      phase: 'handOver',
      rules: DEFAULT_RULES,
      match: { levels: [2, 2], handNo: 1, prevPlacements: [3, 0, 1, 2], winner: null },
      hand: null,
    };
    // 2（末游）手里最大是 ♠A；3（头游）收贡（级数 2，♣5 非级牌）
    const hands: Card[][] = [
      [C(9), C(9, 1)],
      [C(8), C(8, 1)],
      [C(14, 2), C(5, 1)], // 末游：♠A + ♣5（级数 5，♣5 非配）
      [C(10), C(4, 1)], // 头游：还贡候选
    ];
    const res = beginHand(s, hands, mulberry32(1));
    expect(res.ok).toBe(true);
    let st = (res as { state: GameState }).state;
    expect(st.phase).toBe('tribute');
    expect(st.hand!.tribute!.kind).toBe('single');
    expect(st.hand!.tribute!.pairs).toEqual([{ from: 2, to: 3, card: null, returned: null }]);
    // 只能贡 ♠A
    expect(tributableCards(st, 2)).toEqual([C(14, 2)]);
    st = applyOk(st, { t: 'tribute', seat: 2, card: C(14, 2) });
    expect(st.hand!.hands[3]).toContain(C(14, 2));
    expect(st.hand!.hands[2]).not.toContain(C(14, 2));
    expect(st.phase).toBe('tributeReturn');
    // 3 还贡 ≤10 非级牌：手里有 10 和 4（级数 5，4 可还）
    const rets = returnableCards(st, 3);
    expect(rets).toContain(C(4, 1));
    expect(rets).toContain(C(10));
    expect(rets).not.toContain(C(14, 2)); // A 不可还
    st = applyOk(st, { t: 'returnTribute', seat: 3, card: C(4, 1) });
    expect(st.phase).toBe('playing');
    expect(st.hand!.leader).toBe(3); // 收贡者先出
    expect(st.hand!.hands[2]).toContain(C(4, 1));
  });

  it('双贡：末游贡头游、三游贡二游，贡大者收方先出', () => {
    const s: GameState = {
      phase: 'handOver',
      rules: DEFAULT_RULES,
      match: { levels: [2, 2], handNo: 1, prevPlacements: [1, 3, 0, 2], winner: null }, // 队1双下
      hand: null,
    };
    const hands: Card[][] = [
      [C(13, 2), C(6)], // 三游（队0）：贡 ♠K
      [C(7), C(6, 1)], // 头游（队1）
      [C(14, 1), C(3)], // 末游（队0）：贡 ♣A（更大）
      [C(9), C(6, 2)], // 二游（队1）
    ];
    const res = beginHand(s, hands, mulberry32(1));
    let st = (res as { state: GameState }).state;
    expect(st.phase).toBe('tribute');
    expect(st.hand!.tribute!.kind).toBe('double');
    expect(tributableCards(st, 0)).toEqual([C(13, 2)]);
    expect(tributableCards(st, 2)).toEqual([C(14, 1)]);
    st = applyOk(st, { t: 'tribute', seat: 0, card: C(13, 2) });
    st = applyOk(st, { t: 'tribute', seat: 2, card: C(14, 1) });
    expect(st.phase).toBe('tributeReturn');
    st = applyOk(st, { t: 'returnTribute', seat: 1, card: C(6, 1) }); // 头游还
    st = applyOk(st, { t: 'returnTribute', seat: 3, card: C(6, 2) }); // 二游还
    expect(st.phase).toBe('playing');
    expect(st.hand!.leader).toBe(1); // 头游收了较大的 ♣A → 先出
  });

  it('抗贡：贡方合计两大王 → 免贡，上局头游先出', () => {
    const s: GameState = {
      phase: 'handOver',
      rules: DEFAULT_RULES,
      match: { levels: [2, 2], handNo: 1, prevPlacements: [1, 3, 0, 2], winner: null },
      hand: null,
    };
    const hands: Card[][] = [
      [C(16), C(6)], // 三游持大王
      [C(7), C(6, 1)],
      [C(16, 0, 1), C(3)], // 末游持另一大王 → 合计 2
      [C(9), C(6, 2)],
    ];
    const res = beginHand(s, hands, mulberry32(1));
    const st = (res as { state: GameState }).state;
    expect(st.phase).toBe('playing');
    expect(st.hand!.tribute!.resisted).toBe(true);
    expect(st.hand!.leader).toBe(1); // 上局头游
  });
});

describe('引擎：过A与非法动作', () => {
  it('打过A获胜', () => {
    const s0 = craftMatch([[C(16)], [C(15)], [C(13)], [C(5)]], 14, 0, [14, 14]);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(16)], interpId: 0 });
    s = applyOk(s, { t: 'pass', seat: 1 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(13)], interpId: 0 }); // 二游
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(15)], interpId: 0 }); // 三游（小王压K）
    expect(s.phase).toBe('matchOver');
    expect(s.match.winner).toBe(0);
  });

  it('K 级双下跳到 A 但未获胜', () => {
    const s0 = craftMatch([[C(16)], [C(15)], [C(13)], [C(5)]], 13, 0, [13, 13]);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(16)], interpId: 0 });
    s = applyOk(s, { t: 'pass', seat: 1 });
    s = applyOk(s, { t: 'pass', seat: 2 });
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(13)], interpId: 0 }); // 二游 → 双下
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'play', seat: 1, cards: [C(15)], interpId: 0 }); // 小王压 K，三游
    expect(s.phase).toBe('handOver');
    expect(s.match.levels[0]).toBe(14); // 钳制到 A
    expect(s.match.winner).toBeNull();
  });

  it('非法动作被拒', () => {
    const s0 = craftMatch([[C(9), C(9, 1)], [C(3)], [C(11), C(11, 1), C(4)], [C(14)]], 8, 0);
    // 未轮到
    expect(applyAction(s0, { t: 'play', seat: 1, cards: [C(3)], interpId: 0 }, rng()).ok).toBe(false);
    // 首出不能过
    expect(applyAction(s0, { t: 'pass', seat: 0 }, rng()).ok).toBe(false);
    // 不在手
    expect(applyAction(s0, { t: 'play', seat: 0, cards: [C(10)], interpId: 0 }, rng()).ok).toBe(false);
    let s = applyOk(s0, { t: 'play', seat: 0, cards: [C(9), C(9, 1)], interpId: 0 }); // 头游离场
    // 单张压对子被拒
    expect(applyAction(s, { t: 'play', seat: 1, cards: [C(3)], interpId: 0 }, rng()).ok).toBe(false);
    s = applyOk(s, { t: 'pass', seat: 1 });
    expect(applyAction(s, { t: 'play', seat: 2, cards: [C(4)], interpId: 0 }, rng()).ok).toBe(false); // 单张不对型
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(11), C(11, 1)], interpId: 0 }); // JJ 压 99
    s = applyOk(s, { t: 'pass', seat: 3 });
    s = applyOk(s, { t: 'pass', seat: 1 });
    expect(s.hand!.leader).toBe(2); // 2 赢得本轮
    s = applyOk(s, { t: 'play', seat: 2, cards: [C(4)], interpId: 0 }); // 领出（2 出完 → 二游）
    expect(s.hand!.placements).toEqual([0, 2]);
  });
});
