import {
  codeLabel,
  codeOf,
  handInfo,
  isJoker,
  isWildCard,
  orderKey,
  sortHand,
  type Card,
  type GameView,
  type SeatId,
} from '@guandan/core';

export const SEAT_NAMES: Record<SeatId, string> = {
  0: '我',
  1: '右家',
  2: '对家',
  3: '左家',
};

export const TEAM_NAMES = ['蓝方', '红方'] as const;
export const TEAM_CLASSES = ['team-blue', 'team-red'] as const;

/** 进贡候选：手中最大的非逢人配牌（从视图推导，与引擎判定一致） */
export function tributableFromView(view: GameView): Card[] {
  if (!view.tribute?.youOweTribute) return [];
  const cands = view.hand.filter((c) => !isWildCard(c, view.level));
  if (cands.length === 0) return [];
  const best = Math.max(...cands.map((c) => orderKey(codeOf(c), view.level)));
  return cands.filter((c) => orderKey(codeOf(c), view.level) === best);
}

/** 还贡候选：≤10 的非逢人配牌 */
export function returnableFromView(view: GameView): Card[] {
  if (!view.tribute?.youOweReturn) return [];
  return view.hand.filter((c) => !isWildCard(c, view.level) && !isJoker(c) && codeOf(c) <= 10);
}

/** 手牌排序：按大小 或 按同点张数 */
export function sortedHand(hand: Card[], view: GameView, mode: 'rank' | 'count'): Card[] {
  if (mode === 'rank') return sortHand(hand, view.level);
  const info = handInfo(hand, view.level, view.rules);
  return hand.slice().sort((a, b) => {
    const ca = info.hist[codeOf(a)] ?? 0;
    const cb = info.hist[codeOf(b)] ?? 0;
    if (cb !== ca) return cb - ca;
    const ka = orderKey(codeOf(a), view.level);
    const kb = orderKey(codeOf(b), view.level);
    if (kb !== ka) return kb - ka;
    return a - b;
  });
}

/** 座位在牌桌上的方位（0=下 1=右 2=上 3=左） */
export const SEAT_POS: Record<SeatId, 'bottom' | 'right' | 'top' | 'left'> = {
  0: 'bottom',
  1: 'right',
  2: 'top',
  3: 'left',
};

export function placementLabel(place: number): string {
  return ['头游', '二游', '三游', '末游'][place - 1] ?? '';
}

/** orderKey → 点数标签（13=级牌） */
export function keyToLabel(key: number, level: number): string {
  if (key === 13) return codeLabel(level);
  if (key === 14) return '小王';
  if (key === 15) return '大王';
  if (key === -1) return '2';
  return codeLabel(key + 3);
}
