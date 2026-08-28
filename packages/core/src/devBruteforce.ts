import {
  codeOf,
  isJokerCode,
  makeCard,
  orderKey,
  suitOf,
  type Card,
  type CardCode,
  type Suit,
} from './card';
import { runWindows, straightWindows } from './rank';
import { beats, shapeSig, type Shape } from './shape';
import { handInfo } from './hand';
import { interpret, type PlayCtx } from './recognizer';

/**
 * 测试专用暴力解释器（正确性对拍的另一实现）：
 * 把每张逢人配穷举替换为 52 种具体非王牌，再用纯自然牌识别器检查。
 * 与模板法 recognizer 交叉验证，证明“枚举无遗漏、无幻觉”。
 */

/** 纯自然牌形状识别（不含任何逢人配逻辑；若含红桃级牌直接判空） */
export function interpretNatural(cards: Card[], ctx: PlayCtx): Shape[] {
  const info = handInfo(cards, ctx.level, ctx.rules);
  if (info.wilds.length > 0) return [];
  const n = cards.length;
  const H = (c: CardCode): number => info.hist[c];
  const out: Shape[] = [];
  const seen = new Set<string>();
  const add = (s: Shape): void => {
    const sig = shapeSig(s);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(s);
  };
  const codes = [...info.byCode.keys()];

  if (n === 1) add({ k: 'single', key: orderKey(codeOf(cards[0]), ctx.level) });
  if (n === 2 && codes.length === 1) {
    const c = codes[0];
    if (!isJokerCode(c) || ctx.rules.allowJokerPair) add({ k: 'pair', key: orderKey(c, ctx.level) });
  }
  if (n === 3 && codes.length === 1 && !isJokerCode(codes[0])) {
    add({ k: 'trio', key: orderKey(codes[0], ctx.level) });
  }
  if (n >= 4 && n <= 8 && codes.length === 1 && !isJokerCode(codes[0])) {
    add({ k: 'bomb', key: orderKey(codes[0], ctx.level), size: n });
  }
  if (n === 4 && H(15) === 2 && H(16) === 2) add({ k: 'jokerBomb' });
  if (n === 5) {
    for (const t of codes) {
      if (isJokerCode(t) || H(t) !== 3) continue;
      for (const p of codes) {
        if (p === t || H(p) !== 2) continue;
        if (isJokerCode(p) && !ctx.rules.allowJokerAttachment) continue;
        add({ k: 'trioPlusPair', key: orderKey(t, ctx.level) });
      }
    }
  }
  if (n === 6) {
    outer: for (const win of runWindows(ctx.level, 3)) {
      for (const r of win.ranks) if (H(r) !== 2) continue outer;
      for (const c of codes) if (!win.ranks.includes(c)) continue outer;
      add({ k: 'trioRun', key: orderKey(win.topCode, ctx.level) });
    }
  }
  const steelCfg =
    n === 6
      ? { len: 2 as const, kickers: 0 }
      : n === 9
        ? { len: 3 as const, kickers: 0 }
        : n === 10
          ? { len: 2 as const, kickers: 2 }
          : n === 15
            ? { len: 3 as const, kickers: 3 }
            : null;
  if (steelCfg && (steelCfg.kickers > 0 || ctx.rules.allowBareSteel)) {
    outerS: for (const win of runWindows(ctx.level, steelCfg.len)) {
      let bodyCards = 0;
      for (const r of win.ranks) {
        if (H(r) < 3) continue outerS;
        bodyCards += 3;
      }
      const rest = new Map<CardCode, number>();
      for (const c of codes) {
        const cnt = win.ranks.includes(c) ? H(c) - 3 : H(c);
        if (cnt > 0) rest.set(c, cnt);
      }
      let pairs = 0;
      let singles = 0;
      for (const [c, cnt] of rest) {
        if (isJokerCode(c) && !ctx.rules.allowJokerAttachment) continue outerS;
        pairs += Math.floor(cnt / 2);
        singles += cnt % 2;
      }
      if (singles > 0 || pairs !== steelCfg.kickers) continue;
      if (bodyCards + 2 * pairs !== n) continue;
      add({ k: 'steel', key: orderKey(win.topCode, ctx.level), len: steelCfg.len, kickers: steelCfg.kickers });
    }
  }
  if (n === 5) {
    const suits = new Set<Suit>();
    for (const c of cards) suits.add(suitOf(c));
    outerF: for (const win of straightWindows(ctx.level)) {
      for (const r of win.ranks) if (H(r) !== 1) continue outerF;
      for (const c of codes) if (!win.ranks.includes(c)) continue outerF;
      add({ k: 'straight', key: orderKey(win.topCode, ctx.level) });
      if (suits.size === 1) {
        add({ k: 'flushStraight', key: orderKey(win.topCode, ctx.level), suit: suits.values().next().value as Suit });
      }
    }
  }
  return out;
}

/** 暴力版：穷举逢人配的所有替代（≤52^2 种），汇总全部可达 Shape 签名 */
export function bruteForceShapes(cards: Card[], ctx: PlayCtx): Set<string> {
  const info = handInfo(cards, ctx.level, ctx.rules);
  const w = info.wilds.length;
  const naturals = cards.filter((c) => !info.wilds.includes(c));
  const result = new Set<string>();
  const combos: { code: CardCode; suit: Suit }[] = [];
  for (let code = 2; code <= 14; code++) for (let s = 0; s < 4; s++) combos.push({ code, suit: s as Suit });

  const rec = (i: number, acc: Card[]): void => {
    if (i === w) {
      for (const s of interpretNatural([...naturals, ...acc], ctx)) result.add(shapeSig(s));
      return;
    }
    for (const combo of combos) {
      acc.push(makeCard(combo.code, combo.suit, 0));
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return result;
}

/** 比较权能签名：花色不参与大小比较，仅此差异视为同一解释强度 */
export function powerSig(s: Shape): string {
  const key = (s as { key?: number }).key ?? 0;
  const size = s.k === 'bomb' ? s.size : s.k === 'steel' ? `${s.len}:${s.kickers}` : '';
  return `${s.k}|${key}|${size}`;
}

/** 从签名解析回 Shape（对拍专用，格式见 shapeSig） */
export function parseSig(sig: string): Shape {
  const [, key, k, extra, suit, size] = sig.split('|');
  const nKey = Number(key);
  switch (k) {
    case 'single':
      return { k: 'single', key: nKey };
    case 'pair':
      return { k: 'pair', key: nKey };
    case 'trio':
      return { k: 'trio', key: nKey };
    case 'trioPlusPair':
      return { k: 'trioPlusPair', key: nKey };
    case 'trioRun':
      return { k: 'trioRun', key: nKey };
    case 'steel': {
      const [len, kickers] = extra.split(':').map(Number);
      return { k: 'steel', key: nKey, len: len as 2 | 3, kickers };
    }
    case 'straight':
      return { k: 'straight', key: nKey };
    case 'flushStraight':
      return { k: 'flushStraight', key: nKey, suit: Number(suit) as Suit };
    case 'bomb':
      return { k: 'bomb', key: nKey, size: Number(size) };
    default:
      return { k: 'jokerBomb' };
  }
}

/**
 * 对拍：模板解释集合 vs 暴力集合。
 *  1) 模板 ⊆ 暴力（无幻觉）
 *  2) 暴力中每个解释，模板里存在相等或支配它的解释（无遗漏——
 *     被支配的弱解释对“能否压过”没有增量价值，可安全折叠）
 */
export function crossCheck(cards: Card[], ctx: PlayCtx): { ok: boolean; detail: string } {
  const tmpl = interpret(cards, ctx);
  const tmplShapes = tmpl.map((i) => i.shape);
  const brute = bruteForceShapes(cards, ctx);
  for (const t of tmplShapes) {
    if (!brute.has(shapeSig(t))) {
      return { ok: false, detail: `模板多出暴力没有的解释: ${shapeSig(t)}` };
    }
  }
  for (const bsig of brute) {
    const bs = parseSig(bsig);
    const covered = tmplShapes.some(
      (t) => shapeSig(t) === bsig || powerSig(t) === powerSig(bs) || beats(t, bs),
    );
    if (!covered) {
      return { ok: false, detail: `暴力可达但模板缺失且未被支配: ${bsig}` };
    }
  }
  return { ok: true, detail: '' };
}
