/**
 * 牌的紧凑编码（8 位整数）：
 *   bit 0-1  花色 suit：0=♦ 1=♣ 2=♠ 3=♥
 *   bit 2-6  点数 code：2..14（11=J,12=Q,13=K,14=A），15=小王，16=大王（王 suit 恒为 0）
 *   bit 7    副本位 copy：两副牌的物理区分，108 张牌全局唯一
 */
export type Card = number;
export type Suit = 0 | 1 | 2 | 3;
export type RankCode = number; // 2..14
export type JokerCode = 15 | 16;
export type CardCode = RankCode | JokerCode; // 2..16
export type OrderKey = number; // 大小序：2→-1(非级牌时), 3→0 … A→11, 级牌→13, 小王→14, 大王→15

export const HEART = 3 as Suit;
export const SMALL_JOKER = 15 as const;
export const BIG_JOKER = 16 as const;

export function makeCard(code: CardCode, suit: Suit, copy: 0 | 1): Card {
  return (copy << 7) | (code << 2) | suit;
}
export function codeOf(c: Card): CardCode {
  return (c >> 2) & 0x1f;
}
export function suitOf(c: Card): Suit {
  return (c & 3) as Suit;
}
export function copyOf(c: Card): 0 | 1 {
  return ((c >> 7) & 1) as 0 | 1;
}
export function isJokerCode(code: CardCode): code is JokerCode {
  return code >= SMALL_JOKER;
}
export function isJoker(c: Card): boolean {
  return isJokerCode(codeOf(c));
}

/**
 * 牌面大小序的唯一判定入口（级牌介于 A 与小王之间；非级牌的 2 最小）。
 * 业务代码禁止直接比较 RankCode，必须经由此函数。
 */
export function orderKey(code: CardCode, level: RankCode): OrderKey {
  if (code === level) return 13;
  if (code >= SMALL_JOKER) return code - 1; // 小王 14，大王 15
  if (code === 2) return -1;
  return code - 3; // 3→0 … A→11
}

/** 红桃级牌 = 逢人配（百搭），两副牌共 2 张 */
export function isWildCard(c: Card, level: RankCode): boolean {
  return suitOf(c) === HEART && codeOf(c) === level;
}

function buildFullDeck(): Card[] {
  const out: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let code = 2; code <= 14; code++) {
        out.push(makeCard(code as CardCode, suit as Suit, copy as 0 | 1));
      }
    }
    out.push(makeCard(SMALL_JOKER, 0, copy as 0 | 1));
    out.push(makeCard(BIG_JOKER, 0, copy as 0 | 1));
  }
  return out; // 108 张
}

/** 完整牌堆：两副牌 + 4 王 */
export const FULL_DECK: readonly Card[] = buildFullDeck();

/** 手牌排序：按大小降序（级牌置顶），同点按花色、副本稳定排列 */
export function sortHand(cards: Card[], level: RankCode): Card[] {
  return cards.slice().sort((a, b) => {
    const ka = orderKey(codeOf(a), level);
    const kb = orderKey(codeOf(b), level);
    if (kb !== ka) return kb - ka;
    return a - b;
  });
}

/** 牌集合的规范键（去重用）：升序序列化 */
export function cardsKey(cards: Card[]): string {
  return cards.slice().sort((a, b) => a - b).join(',');
}

/** 从一组牌里按确定顺序取 k 张指定点数的物理牌（优先低花色、低副本） */
export function pickPhysical(pool: Card[], k: number): Card[] {
  return pool.slice().sort((a, b) => a - b).slice(0, k);
}

/** 点数显示（中文界面用） */
export function codeLabel(code: CardCode): string {
  if (code === SMALL_JOKER) return '小王';
  if (code === BIG_JOKER) return '大王';
  if (code === 11) return 'J';
  if (code === 12) return 'Q';
  if (code === 13) return 'K';
  if (code === 14) return 'A';
  return String(code);
}

export const SUIT_SYMBOLS = ['♦', '♣', '♠', '♥'] as const;
