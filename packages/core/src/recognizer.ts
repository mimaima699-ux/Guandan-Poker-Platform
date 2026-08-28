import {
  HEART,
  codeOf,
  isJokerCode,
  orderKey,
  suitOf,
  type Card,
  type CardCode,
  type RankCode,
  type Suit,
} from './card';
import { runWindows, straightWindows } from './rank';
import { compareShapeStrength, shapeSig, type Shape } from './shape';
import { DEFAULT_RULES, type RulesConfig } from './rules';
import { handInfo, type HandInfo } from './hand';

/** 逢人配顶替说明（UI 展示“红桃级牌当作什么牌”用；语义由 shape 决定） */
export interface WildAssignment {
  card: Card;
  asCode: CardCode;
  asSuit: Suit;
}

/** 一种合法解释 */
export interface Interpretation {
  shape: Shape;
  wilds: WildAssignment[];
}

export interface PlayCtx {
  level: RankCode;
  rules: RulesConfig;
}

export function makeCtx(level: RankCode, rules: RulesConfig = DEFAULT_RULES): PlayCtx {
  return { level, rules };
}

/**
 * 给定选牌，枚举全部合法解释（按牌力降序、确定性编号）。
 *
 * 算法：形状模板 + 缺口填充。
 *  - 张数精确匹配：所有选牌必须整组打出
 *  - 缺口由逢人配顶替，且配的替代点数必须被自然牌/连序窗口锚定
 *    （纯自由结构的弱化解释按主导关系折叠，如双配对子只保留级牌对）
 *  - 连序窗口不含级牌与王；同花顺自然牌须同花色
 */
export function interpret(cards: Card[], ctx: PlayCtx): Interpretation[] {
  const info = handInfo(cards, ctx.level, ctx.rules);
  const n = cards.length;
  const w = info.wilds.length;
  const H = (code: CardCode): number => info.hist[code];
  const out: Interpretation[] = [];
  const seen = new Set<string>();

  const add = (shape: Shape, wilds: WildAssignment[]): void => {
    const sig = shapeSig(shape);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ shape, wilds });
  };
  // 依次取逢人配做顶替（确定性分配）
  let wildCursor = 0;
  const takeWild = (asCode: CardCode, asSuit: Suit): WildAssignment | null => {
    if (wildCursor >= w) return null;
    const card = info.wilds[wildCursor++];
    return { card, asCode, asSuit };
  };

  /** 单张 */
  if (n === 1) {
    if (w === 1) {
      add({ k: 'single', key: 13 }, []); // 红桃级牌当自己（级牌单张）
    } else {
      add({ k: 'single', key: orderKey(codeOf(cards[0]), ctx.level) }, []);
    }
  }

  /** 对子 */
  if (n === 2) {
    if (w === 0) {
      const a = codeOf(cards[0]);
      const b = codeOf(cards[1]);
      if (a === b && (!isJokerCode(a) || ctx.rules.allowJokerPair)) {
        add({ k: 'pair', key: orderKey(a, ctx.level) }, []);
      }
    } else if (w === 1) {
      const nat = cards.find((c) => !info.wilds.includes(c))!;
      const cn = codeOf(nat);
      if (!isJokerCode(cn)) {
        add({ k: 'pair', key: orderKey(cn, ctx.level) }, [
          { card: info.wilds[0], asCode: cn, asSuit: suitOf(nat) },
        ]);
      }
    } else {
      add({ k: 'pair', key: 13 }, [
        { card: info.wilds[0], asCode: ctx.level, asSuit: HEART },
        { card: info.wilds[1], asCode: ctx.level, asSuit: HEART },
      ]);
    }
  }

  /** 三张（自然牌同点数锚定，逢人配补位；王不可） */
  if (n === 3) {
    const natCodes = distinctNaturalCodes(info);
    if (natCodes.size === 1) {
      const c = natCodes.values().next().value as CardCode;
      if (!isJokerCode(c)) {
        wildCursor = 0;
        const assigns: WildAssignment[] = [];
        for (let i = 0; i < w; i++) assigns.push(takeWild(c, HEART)!);
        add({ k: 'trio', key: orderKey(c, ctx.level) }, assigns);
      }
    }
  }

  /** 炸弹（4~8 张同点）与天王炸 */
  if (n >= 4 && n <= 8) {
    const natCodes = distinctNaturalCodes(info);
    if (natCodes.size === 1) {
      const c = natCodes.values().next().value as CardCode;
      if (!isJokerCode(c)) {
        wildCursor = 0;
        const assigns: WildAssignment[] = [];
        for (let i = 0; i < w; i++) assigns.push(takeWild(c, HEART)!);
        add({ k: 'bomb', key: orderKey(c, ctx.level), size: n }, assigns);
      }
    }
    if (n === 4 && w === 0 && H(15) === 2 && H(16) === 2) {
      add({ k: 'jokerBomb' }, []);
    }
  }

  /** 三带二（三张主体点数 t，附带一对 p≠t；王对默认不可带） */
  if (n === 5) {
    for (const [t, list] of info.byCode) {
      if (isJokerCode(t)) continue;
      const ht = list.length;
      if (ht < 1 || ht > 3) continue;
      const wTrio = 3 - ht;
      if (wTrio > w) continue;
      const wr = w - wTrio;
      // 剩余自然牌（去掉三张主体）
      const rest = new Map<CardCode, number>();
      for (const [c, l] of info.byCode) rest.set(c, c === t ? 0 : l.length);
      let pairOk = false;
      for (const [p, cnt] of rest) {
        if (cnt < 1 || cnt > 2) continue;
        const jokerBad = isJokerCode(p) && !ctx.rules.allowJokerAttachment;
        if (jokerBad) continue;
        if (cnt === 2 || wr >= 1) pairOk = true;
      }
      if (!pairOk && wr >= 2) pairOk = true; // 双配成对（点数任意，同 shape 去重）
      if (pairOk) {
        wildCursor = 0;
        const assigns: WildAssignment[] = [];
        for (let i = 0; i < wTrio; i++) assigns.push(takeWild(t, HEART)!);
        // 确定性地选一个对子来源，标注剩余逢人配的去向（仅展示用）
        let pSrc: CardCode | null = null;
        for (const [p, cnt] of rest) {
          if (p === t || cnt < 1 || cnt > 2) continue;
          if (isJokerCode(p) && !ctx.rules.allowJokerAttachment) continue;
          if (cnt === 2 || wr >= 1) {
            pSrc = p;
            break;
          }
        }
        const pairWilds = pSrc !== null ? Math.max(0, 2 - (rest.get(pSrc) ?? 0)) : wr;
        for (let i = 0; i < Math.min(pairWilds, wr); i++) {
          assigns.push(takeWild(pSrc ?? ctx.level, HEART)!);
        }
        add({ k: 'trioPlusPair', key: orderKey(t, ctx.level) }, assigns);
      }
    }
  }

  /** 三连对（3 个连续点数各 2 张，可用配补位） */
  if (n === 6) {
    for (const win of runWindows(ctx.level, 3)) {
      if (!windowExactFit(info, win.ranks, 2, w)) continue;
      wildCursor = 0;
      const assigns: WildAssignment[] = [];
      for (const r of win.ranks) {
        const fill = 2 - Math.min(H(r), 2);
        for (let i = 0; i < fill; i++) assigns.push(takeWild(r, HEART)!);
      }
      add({ k: 'trioRun', key: orderKey(win.topCode, ctx.level) }, assigns);
    }
  }

  /** 钢板（2/3 个连续三张，可带等量对子；裸钢板可配置） */
  {
    const cfg =
      n === 6
        ? { len: 2 as const, kickers: 0 }
        : n === 9
          ? { len: 3 as const, kickers: 0 }
          : n === 10
            ? { len: 2 as const, kickers: 2 }
            : n === 15
              ? { len: 3 as const, kickers: 3 }
              : null;
    if (cfg && (cfg.kickers > 0 || ctx.rules.allowBareSteel)) {
      for (const win of runWindows(ctx.level, cfg.len)) {
        // 主体：每点数至少可用 3 张（超出部分流入带对池），缺口由配补
        let fill = 0;
        let ok = true;
        for (const r of win.ranks) {
          fill += Math.max(0, 3 - H(r));
        }
        if (fill > w) continue;
        // 带对池：窗口内超出 3 的部分 + 窗口外全部自然牌
        let poolTotal = 0;
        let singles = 0;
        for (const [c, l] of info.byCode) {
          const inWin = win.ranks.includes(c);
          const cnt = inWin ? Math.max(0, l.length - 3) : l.length;
          if (cnt > 0) {
            if (isJokerCode(c) && !ctx.rules.allowJokerAttachment) {
              ok = false;
              break;
            }
            poolTotal += cnt;
            singles += cnt % 2;
          }
        }
        if (!ok) continue;
        const wr = w - fill;
        if (singles > wr) continue;
        if (poolTotal + wr !== 2 * cfg.kickers) continue;
        wildCursor = 0;
        const assigns: WildAssignment[] = [];
        for (const r of win.ranks) {
          const f = Math.max(0, 3 - H(r));
          for (let i = 0; i < f; i++) assigns.push(takeWild(r, HEART)!);
        }
        for (let i = 0; i < wr; i++) assigns.push(takeWild(ctx.level, HEART)!); // 带对补位（点数任意）
        add(
          { k: 'steel', key: orderKey(win.topCode, ctx.level), len: cfg.len, kickers: cfg.kickers },
          assigns,
        );
      }
    }
  }

  /** 顺子与同花顺（5 张连续；A2345 特例；窗口不含级牌） */
  if (n === 5) {
    const naturalSuits = new Set<Suit>();
    for (const c of cards) {
      if (info.wilds.includes(c)) continue;
      if (isJokerCode(codeOf(c))) naturalSuits.add(-1 as Suit);
      else naturalSuits.add(suitOf(c));
    }
    for (const win of straightWindows(ctx.level)) {
      if (!windowExactFit(info, win.ranks, 1, w)) continue;
      wildCursor = 0;
      const assigns: WildAssignment[] = [];
      for (const r of win.ranks) {
        if (H(r) === 0) assigns.push(takeWild(r, HEART)!);
      }
      add({ k: 'straight', key: orderKey(win.topCode, ctx.level) }, assigns);
      if (naturalSuits.size === 1) {
        const s = naturalSuits.values().next().value as Suit;
        wildCursor = 0;
        const fAssigns: WildAssignment[] = [];
        for (const r of win.ranks) {
          if (H(r) === 0) fAssigns.push(takeWild(r, s)!);
        }
        add({ k: 'flushStraight', key: orderKey(win.topCode, ctx.level), suit: s }, fAssigns);
      }
    }
  }

  out.sort((a, b) => compareShapeStrength(a.shape, b.shape));
  return out;
}

/** 窗口精确匹配：每点数自然牌 ≤ need、缺口合计 = w、窗口外自然牌为 0 */
function windowExactFit(info: HandInfo, ranks: CardCode[], need: number, w: number): boolean {
  let fill = 0;
  for (const r of ranks) {
    const h = info.hist[r];
    if (h > need) return false;
    fill += need - h;
  }
  if (fill !== w) return false;
  for (const [c, l] of info.byCode) {
    if (l.length > 0 && !ranks.includes(c)) return false;
  }
  return true;
}

function distinctNaturalCodes(info: HandInfo): Set<CardCode> {
  return new Set(info.byCode.keys());
}
