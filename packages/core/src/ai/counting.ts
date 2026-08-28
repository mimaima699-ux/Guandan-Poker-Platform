import { codeOf, orderKey, type Card, type RankCode } from '../card';
import type { Shape } from '../shape';

/** 两副牌总量：点数 2..14 各 8 张，小王 15 / 大王 16 各 2 张 */
const TOTAL: readonly number[] = (() => {
  const t = new Array<number>(17).fill(0);
  for (let code = 2; code <= 14; code++) t[code] = 8;
  t[15] = 2;
  t[16] = 2;
  return t;
})();

/** 记牌器结果：某点数还剩多少张「既不在我手里、也还没被打出」——即散落在他人手中（含未翻出） */
export interface HiddenInfo {
  /** 下标 = 点数（2..14 普通点，15 小王，16 大王） */
  remaining: Int16Array;
  bigJokers: number;
  smallJokers: number;
}

/** 从我的手牌 + 已打出的牌，反推还有哪些点数「在外面」 */
export function countHidden(myHand: Card[], played: Card[]): HiddenInfo {
  const remaining = new Int16Array(17);
  for (let code = 2; code <= 16; code++) remaining[code] = TOTAL[code];
  const sub = (c: Card): void => {
    const code = codeOf(c);
    if (code >= 2 && code <= 16) remaining[code]--;
  };
  for (const c of myHand) sub(c);
  for (const c of played) sub(c);
  return { remaining, bigJokers: remaining[16], smallJokers: remaining[15] };
}

/**
 * 我的炸「当前是否无人能再压」，用于决定该不该烧这张炸。
 * 近似成立当且仅当：别人手里不存在更大张数的炸、同张数更大点数的炸、或天王炸。
 * （未计入他人用逢人配扩成更大炸或凑同花顺的情况——那是保守方向上的已知近似。）
 */
export function bombIsTop(
  size: number,
  bombKey: number,
  hidden: HiddenInfo,
  level: RankCode,
): boolean {
  for (let code = 2; code <= 14; code++) {
    const n = hidden.remaining[code];
    if (n >= size + 1) return false; // 更大张数的炸
    if (n === size && orderKey(code, level) > bombKey) return false; // 同张数更大的炸
  }
  if (hidden.bigJokers >= 2 && hidden.smallJokers >= 2) return false; // 天王炸
  return true;
}

/** 是否存在某点数，其剩余张数 ≥ need 且点数比 key 大（用来判断「这一手还能不能被压」） */
function hasHigher(hidden: HiddenInfo, need: number, key: number, level: RankCode): boolean {
  for (let code = 2; code <= 16; code++) {
    if (hidden.remaining[code] >= need && orderKey(code, level) > key) return true;
  }
  return false;
}

/**
 * 这一手打出去后，「剩下的对手」是否还能再压（true=稳赢牌权 / false=会被反压 / null=不建模）。
 * 单张/对子/三张用剩余张数精确判定，炸弹复用 bombIsTop；连牌类（顺子/钢板等）无法廉价判定返回 null。
 */
export function wouldWin(shape: Shape, hidden: HiddenInfo, level: RankCode): boolean | null {
  switch (shape.k) {
    case 'single':
      return !hasHigher(hidden, 1, shape.key, level);
    case 'pair':
      return !hasHigher(hidden, 2, shape.key, level);
    case 'trio':
      return !hasHigher(hidden, 3, shape.key, level);
    case 'bomb':
      return bombIsTop(shape.size, shape.key, hidden, level);
    case 'jokerBomb':
      return true;
    default:
      return null;
  }
}