import type { Suit } from './card';

/**
 * 牌型。key/top 均为 orderKey 值（比较入口唯一化）。
 * - trioPlusPair / steel 只比主体点数，带的对子不参与比较
 * - steel.kickers = 附属对子数（0=裸钢板）
 */
export type Shape =
  | { k: 'single'; key: number }
  | { k: 'pair'; key: number }
  | { k: 'trio'; key: number }
  | { k: 'trioPlusPair'; key: number }
  | { k: 'trioRun'; key: number } // 三连对（3 个连续对子）
  | { k: 'steel'; key: number; len: 2 | 3; kickers: number }
  | { k: 'straight'; key: number }
  | { k: 'flushStraight'; key: number; suit: Suit }
  | { k: 'bomb'; key: number; size: number }
  | { k: 'jokerBomb' };

export type ShapeKind = Shape['k'];

/** 牌型总张数 */
export function sizeOfShape(s: Shape): number {
  switch (s.k) {
    case 'single':
      return 1;
    case 'pair':
      return 2;
    case 'trio':
      return 3;
    case 'trioPlusPair':
      return 5;
    case 'trioRun':
      return 6;
    case 'steel':
      return s.kickers === 0 ? 3 * s.len : 5 * s.len;
    case 'straight':
    case 'flushStraight':
      return 5;
    case 'bomb':
      return s.size;
    case 'jokerBomb':
      return 4;
  }
}

/**
 * 火力层级：
 *   0 普通 | 1 五张及以下炸弹 | 2 同花顺 | 3 六张及以上炸弹 | 4 天王炸
 */
export type Tier = 0 | 1 | 2 | 3 | 4;
export function tierOf(s: Shape): Tier {
  switch (s.k) {
    case 'jokerBomb':
      return 4;
    case 'bomb':
      return s.size >= 6 ? 3 : 1;
    case 'flushStraight':
      return 2;
    default:
      return 0;
  }
}

/** 形状比较键（天王炸无 key，取 0——它仅与 tier 4 内部比较，永不比较 key） */
export function keyOf(s: Shape): number {
  return (s as { key?: number }).key ?? 0;
}

/** a 是否压过 b（同 tier 同型同张数比点数；炸弹张数多者大；同花顺比最大点数） */
export function beats(a: Shape, b: Shape): boolean {
  const ta = tierOf(a);
  const tb = tierOf(b);
  if (ta !== tb) return ta > tb;
  if (ta === 4) return false; // 天王炸之间不可再压
  if (ta === 2) return keyOf(a) > keyOf(b); // 同花顺之间比 top
  if (ta === 1 || ta === 3) {
    // 炸弹：张数多者大，同张数比点数
    const ab = a as Extract<Shape, { k: 'bomb' }>;
    const bb = b as Extract<Shape, { k: 'bomb' }>;
    return ab.size > bb.size || (ab.size === bb.size && ab.key > bb.key);
  }
  // tier 0：同型同张数才可比
  if (a.k !== b.k) return false;
  if (sizeOfShape(a) !== sizeOfShape(b)) return false;
  return keyOf(a) > keyOf(b);
}

/** 解释的确定性排序签名（tier 降序、点数降序、类型名升序）——解释 id 的依据 */
export function shapeSig(s: Shape): string {
  const key = (s as { key?: number }).key ?? 0;
  return `${tierOf(s)}|${key}|${s.k}|${s.k === 'steel' ? `${s.len}:${s.kickers}` : ''}|${
    s.k === 'flushStraight' ? s.suit : ''
  }|${s.k === 'bomb' ? s.size : ''}`;
}

/** 解释排序：强解释在前（用于 UI 默认选择与 id 稳定化） */
export function compareShapeStrength(a: Shape, b: Shape): number {
  const ta = tierOf(a) - tierOf(b);
  if (ta !== 0) return -ta;
  const ka = keyOf(a);
  const kb = keyOf(b);
  if (kb !== ka) return kb - ka;
  const sa = sizeOfShape(a) - sizeOfShape(b);
  if (sa !== 0) return -sa;
  return a.k < b.k ? -1 : a.k > b.k ? 1 : 0;
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  single: '单张',
  pair: '对子',
  trio: '三张',
  trioPlusPair: '三带二',
  trioRun: '三连对',
  steel: '钢板',
  straight: '顺子',
  flushStraight: '同花顺',
  bomb: '炸弹',
  jokerBomb: '天王炸',
};
