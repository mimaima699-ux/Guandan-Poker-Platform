import {
  codeOf,
  isJokerCode,
  orderKey,
  suitOf,
  type Card,
  type CardCode,
  type Suit,
} from './card';
import { runWindows, straightWindows, type SeqWindow } from './rank';
import { beats, sizeOfShape, type Shape } from './shape';
import { handInfo, type HandInfo } from './hand';
import { interpret, type Interpretation, type PlayCtx } from './recognizer';

/** 一个可出的候选：具体物理选牌 + 该选牌的全部解释（强解释在前） */
export interface PlayOption {
  cards: Card[];
  interps: Interpretation[];
}

/**
 * 领出候选：枚举手牌中全部可出的牌组（每个不同选牌一个候选）。
 * 构造方向：按形状模板从手牌取牌，逢人配优先补缺口。
 */
export function leadOptions(hand: Card[], ctx: PlayCtx): PlayOption[] {
  const info = handInfo(hand, ctx.level, ctx.rules);
  const w = info.wilds.length;
  const H = (code: CardCode): number => info.hist[code];
  const bySuit = buildBySuit(info); // 同花顺用：Map<suit, Map<code, Card>>
  const opts: PlayOption[] = [];
  const seen = new Set<string>();
  const push = (cards: Card[]): void => {
    if (cards.length === 0) return;
    const key = cardsKeyOf(cards);
    if (seen.has(key)) return;
    const interps = interpret(cards, ctx);
    if (interps.length === 0) return;
    seen.add(key);
    opts.push({ cards: cards.slice().sort((a, b) => a - b), interps });
  };
  const wilds = (k: number): Card[] => info.wilds.slice(0, k);

  // —— 单张：每个点数一张 + 红桃级牌单张
  for (const [, list] of info.byCode) push([list[0]]);
  if (w >= 1) push([info.wilds[0]]);

  // —— 对子
  for (const [code, list] of info.byCode) {
    const joker = isJokerCode(code);
    if (list.length >= 2 && (!joker || ctx.rules.allowJokerPair)) push(list.slice(0, 2));
    else if (list.length === 1 && w >= 1 && !joker) push([list[0], ...wilds(1)]);
  }
  if (w >= 2) push(wilds(2)); // 双百搭当级牌对

  // —— 三张
  for (const [code, list] of info.byCode) {
    if (isJokerCode(code)) continue;
    const take = Math.min(3, list.length);
    const fill = 3 - take;
    if (list.length >= 1 && fill <= w) push([...list.slice(0, take), ...wilds(fill)]);
  }

  // —— 炸弹（4~8 张，自然牌优先、从小到大；含百搭扩容）+ 天王炸
  for (const [code, list] of info.byCode) {
    if (isJokerCode(code)) continue;
    const max = Math.min(8, list.length + w);
    for (let size = 4; size <= max; size++) {
      const take = Math.min(size, list.length);
      push([...list.slice(0, take), ...wilds(size - take)]);
    }
  }
  {
    const s = info.byCode.get(15);
    const b = info.byCode.get(16);
    if (s && s.length >= 2 && b && b.length >= 2) push([s[0], s[1], b[0], b[1]]);
  }

  // —— 三带二
  for (const [t, tlist] of info.byCode) {
    if (isJokerCode(t)) continue;
    const ht = Math.min(3, tlist.length);
    if (tlist.length < 1) continue;
    const wTrio = 3 - ht;
    if (wTrio > w) continue;
    const trioCards = [...tlist.slice(0, ht), ...wilds(wTrio)];
    const wr = w - wTrio;
    for (const [p, plist] of info.byCode) {
      if (p === t) continue;
      const jokerBad = isJokerCode(p) && !ctx.rules.allowJokerAttachment;
      if (jokerBad) continue;
      if (plist.length >= 2) push([...trioCards, plist[0], plist[1]]);
      else if (plist.length === 1 && wr >= 1) push([...trioCards, plist[0], ...wilds(wTrio + 1).slice(wTrio)]);
    }
    if (wr >= 2) push([...trioCards, ...info.wilds.slice(wTrio, wTrio + 2)]); // 双百搭当对子（用剩余的配，避免与主体重复）
  }

  // —— 顺子 / 同花顺
  for (const win of straightWindows(ctx.level)) {
    push(fillWindow(info, win, 1, w));
    for (const s of [0, 1, 2, 3] as Suit[]) {
      const suitMap = bySuit.get(s);
      if (!suitMap) continue;
      const cards: Card[] = [];
      let wildNeed = 0;
      let ok = true;
      for (const r of win.ranks) {
        const c = suitMap.get(r);
        if (c) cards.push(c);
        else wildNeed++;
      }
      if (ok && wildNeed <= w) {
        cards.push(...wilds(wildNeed));
        push(cards);
      }
    }
  }

  // —— 三连对
  for (const win of runWindows(ctx.level, 3)) {
    push(fillWindow(info, win, 2, w));
  }

  // —— 钢板（裸 + 带对两个变体）
  for (const len of [2, 3] as const) {
    for (const win of runWindows(ctx.level, len)) {
      // 主体：每点数取 min(H,3)，缺口配补
      let fill = 0;
      let ok = true;
      const body: Card[] = [];
      for (const r of win.ranks) {
        const h = H(r);
        const take = Math.min(3, h);
        fill += 3 - take;
        if (take > 0) body.push(...(info.byCode.get(r) ?? []).slice(0, take));
      }
      if (!ok || fill > w) continue;
      const bodyCards = [...body, ...wilds(fill)];
      if (ctx.rules.allowBareSteel) push(bodyCards);
      // 带对：剩余牌 + 剩余配组成 len 个对子
      const wr = w - fill;
      const pool = poolAfter(info, win.ranks, 3);
      if (kickersFeasible(pool, wr, len)) {
        const kick = pickKickers(pool, wr, len, info);
        if (kick) push([...bodyCards, ...kick]);
      }
    }
  }

  return opts;
}

/** 压牌候选：所有存在“压过 target 的解释”的出法（含升维火力） */
export function beatOptions(hand: Card[], target: Shape, ctx: PlayCtx): PlayOption[] {
  return leadOptions(hand, ctx).filter((o) => o.interps.some((i) => beats(i.shape, target)));
}

/** 手牌里能否压过 target（快判断） */
export function canBeat(hand: Card[], target: Shape, ctx: PlayCtx): boolean {
  return beatOptions(hand, target, ctx).length > 0;
}

// —————— 内部工具 ——————

function cardsKeyOf(cards: Card[]): string {
  return cards.slice().sort((a, b) => a - b).join(',');
}

function buildBySuit(info: HandInfo): Map<Suit, Map<CardCode, Card>> {
  const m = new Map<Suit, Map<CardCode, Card>>();
  for (const [, list] of info.byCode) {
    for (const c of list) {
      const s = suitOf(c);
      let sm = m.get(s);
      if (!sm) {
        sm = new Map();
        m.set(s, sm);
      }
      if (!sm.has(codeOf(c))) sm.set(codeOf(c), c);
    }
  }
  return m;
}

/** 窗口取牌：每点数取 min(H, need)，缺口用逢人配补 */
function fillWindow(info: HandInfo, win: SeqWindow, need: number, w: number): Card[] {
  const cards: Card[] = [];
  let wildNeed = 0;
  for (const r of win.ranks) {
    const list = info.byCode.get(r);
    if (list && list.length > 0) cards.push(list[0]);
    else wildNeed++;
    if (need === 2 && list && list.length >= 2) cards.push(list[1]);
    else if (need === 2) wildNeed++;
  }
  if (wildNeed > w) return [];
  cards.push(...info.wilds.slice(0, wildNeed));
  return cards;
}

/** 主体取走后的剩余自然牌池（窗口内每点数超出 used 的部分 + 窗口外全部） */
function poolAfter(info: HandInfo, ranks: CardCode[], used: number): Map<CardCode, Card[]> {
  const pool = new Map<CardCode, Card[]>();
  for (const [c, list] of info.byCode) {
    const inWin = ranks.includes(c);
    const rest = inWin ? list.slice(Math.min(used, list.length)) : list.slice();
    if (rest.length > 0) pool.set(c, rest);
  }
  return pool;
}

/** 剩余池 + 剩余配能否组成 k 个对子（单张数 ≤ 配数；王对默认不可） */
function kickersFeasible(pool: Map<CardCode, Card[]>, wr: number, k: number): boolean {
  let total = 0;
  let singles = 0;
  for (const [c, list] of pool) {
    if (isJokerCode(c) && list.length > 0) return false;
    total += list.length;
    singles += list.length % 2;
  }
  return total + wr === 2 * k && singles <= wr;
}

/** 从池中确定性地挑 k 个对子（小点数优先；单张配百搭补） */
function pickKickers(
  pool: Map<CardCode, Card[]>,
  wr: number,
  k: number,
  info: HandInfo,
): Card[] | null {
  const out: Card[] = [];
  let wildLeft = wr;
  const codes = [...pool.keys()].sort((a, b) => orderKey(a, info.level) - orderKey(b, info.level));
  for (const c of codes) {
    if (out.length / 2 >= k) break;
    const list = pool.get(c)!;
    const pairs = Math.floor(list.length / 2);
    for (let i = 0; i < pairs && out.length / 2 < k; i++) out.push(list[i * 2], list[i * 2 + 1]);
    if (list.length % 2 === 1 && out.length / 2 < k && wildLeft > 0) {
      out.push(list[list.length - 1], info.wilds[info.wilds.length - wildLeft]);
      wildLeft--;
    }
  }
  while (out.length / 2 < k && wildLeft >= 2) {
    out.push(info.wilds[info.wilds.length - wildLeft], info.wilds[info.wilds.length - wildLeft + 1]);
    wildLeft -= 2;
  }
  return out.length / 2 === k ? out : null;
}

/** 供 UI / AI 使用的形状规模（按张数） */
export function optionSize(o: PlayOption): number {
  return sizeOfShape(o.interps[0].shape);
}
