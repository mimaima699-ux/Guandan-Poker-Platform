import { codeOf, isWildCard, type Card, type CardCode, type RankCode } from './card';
import type { RulesConfig } from './rules';

/** 一组牌的规范化视图：按点数聚合 + 逢人配独立池（一切牌型运算的统一底座） */
export interface HandInfo {
  cards: Card[];
  level: RankCode;
  rules: RulesConfig;
  /** 自然牌按点数聚合（含王：15=小王 16=大王；含非红桃级牌） */
  byCode: Map<CardCode, Card[]>;
  /** 红桃级牌（逢人配），至多 2 张 */
  wilds: Card[];
  /** 自然牌点数直方图（下标 = code，不含逢人配） */
  hist: Int8Array;
}

export function handInfo(cards: Card[], level: RankCode, rules: RulesConfig): HandInfo {
  const byCode = new Map<CardCode, Card[]>();
  const wilds: Card[] = [];
  const hist = new Int8Array(17);
  for (const c of cards) {
    if (isWildCard(c, level)) {
      wilds.push(c);
      continue;
    }
    const code = codeOf(c);
    let list = byCode.get(code);
    if (!list) {
      list = [];
      byCode.set(code, list);
    }
    list.push(c);
    hist[code]++;
  }
  return { cards: cards.slice(), level, rules, byCode, wilds, hist };
}
