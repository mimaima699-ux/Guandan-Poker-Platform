import type { Card } from '../card';
import type { PlayCtx } from '../recognizer';
import { leadOptions } from '../enumerator';

/**
 * 贪心估算把手出完大致需要几手（越小手牌越顺）。
 * 每步从「领出候选」里拿张数最多的一手，反复直到空手。
 * 它是手牌「紧凑度」的一阶估计：领出/跟牌选牌时用它做结构信号。
 */
export function handPlays(hand: Card[], ctx: PlayCtx): number {
  let rest = hand.slice();
  let plays = 0;
  while (rest.length > 0) {
    const opts = leadOptions(rest, ctx);
    let best: Card[] | null = null;
    for (const o of opts) {
      if (best === null || o.cards.length > best.length) best = o.cards;
    }
    if (best === null) return plays + rest.length; // 理论不可达，兜底防死循环
    const used = new Set(best);
    rest = rest.filter((c) => !used.has(c));
    plays++;
  }
  return plays;
}