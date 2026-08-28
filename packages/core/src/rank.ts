import type { CardCode, RankCode } from './card';

/**
 * 连序窗口（顺子 / 三连对 / 钢板 / 同花顺共用）。
 * 域规则：{3..A} 自然连续 + 顺子特例 A2345（A 视作 1）；不含王；
 * 窗口含级牌则整体非法（级牌不参与连序，逢人配也补不了）。
 */
export interface SeqWindow {
  ranks: CardCode[];
  topCode: CardCode; // 窗口最高点数（A2345 的 top 为 5）
}

/** 顺子窗口：5 张连续。含 A2345 特例（级数为 2 或 A 时该特例非法） */
export function straightWindows(level: RankCode): SeqWindow[] {
  const out: SeqWindow[] = [];
  if (level !== 2 && level !== 14) {
    out.push({ ranks: [14, 2, 3, 4, 5], topCode: 5 });
  }
  for (let s = 3; s <= 10; s++) {
    const ranks: CardCode[] = [s, s + 1, s + 2, s + 3, s + 4];
    if (ranks.includes(level)) continue;
    out.push({ ranks, topCode: s + 4 });
  }
  return out;
}

/** 连续 run 窗口（len 个连续点数）：三连对 len=3、钢板 len=2|3。不含 A2345 特例 */
export function runWindows(level: RankCode, len: 2 | 3): SeqWindow[] {
  const out: SeqWindow[] = [];
  for (let s = 3; s + len - 1 <= 14; s++) {
    const ranks: CardCode[] = [];
    for (let i = 0; i < len; i++) ranks.push(s + i);
    if (ranks.includes(level)) continue;
    out.push({ ranks, topCode: s + len - 1 });
  }
  return out;
}
