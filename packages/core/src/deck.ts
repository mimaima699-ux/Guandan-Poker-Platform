import { FULL_DECK, sortHand, type Card, type RankCode } from './card';
import type { Rng } from './rng';

/** 洗牌（Fisher–Yates，种子化） */
export function shuffledDeck(rng: Rng): Card[] {
  const d = FULL_DECK.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }
  return d;
}

/** 发牌：4 人各 27 张，座位 i 拿第 i 摞（已按级排序） */
export function dealHands(rng: Rng, level: RankCode): Card[][] {
  const d = shuffledDeck(rng);
  const hands: Card[][] = [];
  for (let i = 0; i < 4; i++) {
    hands.push(sortHand(d.slice(i * 27, (i + 1) * 27), level));
  }
  return hands;
}
