import {
  BIG_JOKER,
  codeOf,
  isJokerCode,
  isWildCard,
  orderKey,
  sortHand,
  type Card,
  type RankCode,
} from '../card';
import { dealHands } from '../deck';
import { beats } from '../shape';
import { interpret } from '../recognizer';
import { nextSeat, partnerOf, teamOf, type SeatId } from '../types';
import type { Rng } from '../rng';
import type {
  EngineEvent,
  GameState,
  HandState,
  TributePair,
} from './state';

export type Action =
  | { t: 'deal' }
  | { t: 'tribute'; seat: SeatId; card: Card }
  | { t: 'returnTribute'; seat: SeatId; card: Card }
  | { t: 'play'; seat: SeatId; cards: Card[]; interpId: number }
  | { t: 'pass'; seat: SeatId };

export type ApplyResult =
  | { ok: true; state: GameState; events: EngineEvent[] }
  | { ok: false; error: string };

const A_LEVEL = 14;

/** 当前手牌非空座位数 */
export function activeSeats(h: HandState): SeatId[] {
  return [0, 1, 2, 3].filter((s) => h.hands[s].length > 0) as SeatId[];
}

/** 从 from 起（含）顺时针第一个有牌的座位 */
export function nextActive(h: HandState, from: SeatId): SeatId | null {
  let s = from;
  for (let i = 0; i < 4; i++) {
    if (h.hands[s].length > 0) return s;
    s = nextSeat(s);
  }
  return null;
}

/** 应用动作（纯函数；随机源显式注入，仅 deal 使用） */
export function applyAction(state: GameState, action: Action, rng: Rng): ApplyResult {
  switch (action.t) {
    case 'deal':
      return applyDeal(state, rng);
    case 'tribute':
      return applyTribute(state, action.seat, action.card);
    case 'returnTribute':
      return applyReturn(state, action.seat, action.card);
    case 'play':
      return applyPlay(state, action.seat, action.cards, action.interpId);
    case 'pass':
      return applyPass(state, action.seat);
  }
}

/** —— 发牌与进贡体系初始化 —— */
function applyDeal(state: GameState, rng: Rng): ApplyResult {
  if (state.phase !== 'idle' && state.phase !== 'handOver') {
    return { ok: false, error: `当前阶段 ${state.phase} 不能发牌` };
  }
  const level = handLevel(state.rules, state.match.levels);
  return beginHand(state, dealHands(rng, level), rng);
}

/** 以给定手牌开局（测试与回放用；内部与正常发牌共用同一路径） */
export function beginHand(state: GameState, hands: Card[][], rng: Rng): ApplyResult {
  const events: EngineEvent[] = [];
  const match = { ...state.match, handNo: state.match.handNo + 1 };
  const level = handLevel(state.rules, match.levels);

  const prev = match.prevPlacements;
  let tribute: HandState['tribute'] = null;
  let phase: GameState['phase'] = 'playing';
  let leader: SeatId;

  if (!prev) {
    // 首局：随机首出，无进贡
    leader = rng.int(4) as SeatId;
  } else {
    const first = prev[0]; // 头游
    // 双下 = 头游与二游同队（败方拿了三游+末游）→ 双贡；否则单贡
    const doubleDown = teamOf(prev[1]) === teamOf(first);
    const moYou = prev[3];
    const sanYou = prev[2];
    // 抗贡：贡家（双下=两家合计，单下=末游）持有 ≥2 张大王
    const tributers: SeatId[] = doubleDown ? [moYou, sanYou] : [moYou];
    const bigJokers = tributers.reduce(
      (n: number, s) => n + hands[s].filter((c) => codeOf(c) === BIG_JOKER).length,
      0,
    );
    if (bigJokers >= 2) {
      // 抗贡：直接由上局头游首出
      tribute = { kind: doubleDown ? 'double' : 'single', pairs: [], resisted: true };
      leader = first;
      events.push({ t: 'tributeResisted' });
    } else if (doubleDown) {
      // 双下双贡：末游贡头游、三游贡二游
      const pairs: TributePair[] = [
        { from: moYou, to: first, card: null, returned: null },
        { from: sanYou, to: prev[1], card: null, returned: null },
      ];
      tribute = { kind: 'double', pairs, resisted: false };
      phase = 'tribute';
      leader = -1 as SeatId; // 贡后确定
      events.push({ t: 'tributeDue', pairs: pairs.map((p) => ({ from: p.from, to: p.to })) });
    } else {
      // 单贡：末游贡头游
      const pairs: TributePair[] = [{ from: moYou, to: first, card: null, returned: null }];
      tribute = { kind: 'single', pairs, resisted: false };
      phase = 'tribute';
      leader = -1 as SeatId;
      events.push({ t: 'tributeDue', pairs: pairs.map((p) => ({ from: p.from, to: p.to })) });
    }
  }

  const hand: HandState = {
    level,
    hands,
    leader,
    turn: leader,
    last: null,
    passes: 0,
    placements: [],
    currentTrick: [],
    stream: [],
    tribute,
  };
  events.unshift({ t: 'dealt', level, leader });
  return {
    ok: true,
    state: { ...state, phase, match, hand },
    events,
  };
}

/**
 * 本局级数：按两队中级数较高者打。
 * （levelPolicy 语义下两种策略等价：胜方级数恒 ≥ 负方级数）
 */
export function handLevel(_rules: GameState['rules'], levels: [RankCode, RankCode]): RankCode {
  return Math.max(levels[0], levels[1]) as RankCode;
}

/** —— 进贡：必须贡手中最大的非逢人配牌 —— */
function applyTribute(state: GameState, seat: SeatId, card: Card): ApplyResult {
  const h = state.hand;
  if (!h || state.phase !== 'tribute') return { ok: false, error: '当前不在进贡阶段' };
  const trib = h.tribute!;
  const pair = trib.pairs.find((p) => p.from === seat && p.card === null);
  if (!pair) return { ok: false, error: '该座位无需进贡' };
  const hand = h.hands[seat];
  if (!hand.includes(card)) return { ok: false, error: '贡牌不在手中' };
  if (isWildCard(card, h.level)) return { ok: false, error: '逢人配不可进贡' };
  const maxKey = Math.max(
    ...hand.filter((c) => !isWildCard(c, h.level)).map((c) => orderKey(codeOf(c), h.level)),
  );
  if (orderKey(codeOf(card), h.level) !== maxKey) {
    return { ok: false, error: '进贡必须交出手中最大的牌（逢人配除外）' };
  }
  // 转移牌
  const hands = h.hands.map((x) => x.slice()) as Card[][];
  hands[seat] = hands[seat].filter((c) => c !== card);
  hands[pair.to] = sortHand([...hands[pair.to], card], h.level);
  const pairs = trib.pairs.map((p) => (p === pair ? { ...p, card } : p));
  const events: EngineEvent[] = [{ t: 'tributed', from: seat, to: pair.to, card }];
  const allDone = pairs.every((p) => p.card !== null);
  let phase: GameState['phase'] = 'tribute';
  if (allDone) phase = 'tributeReturn';
  return {
    ok: true,
    state: {
      ...state,
      phase,
      hand: { ...h, hands, tribute: { ...trib, pairs } },
    },
    events,
  };
}

/** —— 还贡：收贡者还一张 ≤10 的非逢人配牌 —— */
function applyReturn(state: GameState, seat: SeatId, card: Card): ApplyResult {
  const h = state.hand;
  if (!h || state.phase !== 'tributeReturn') return { ok: false, error: '当前不在还贡阶段' };
  const trib = h.tribute!;
  const pair = trib.pairs.find((p) => p.to === seat && p.returned === null);
  if (!pair) return { ok: false, error: '该座位无需还贡' };
  const hand = h.hands[seat];
  if (!hand.includes(card)) return { ok: false, error: '还贡牌不在手中' };
  if (isWildCard(card, h.level)) return { ok: false, error: '逢人配不可还贡' };
  if (codeOf(card) > 10) return { ok: false, error: '还贡不得大于 10' };
  const hands = h.hands.map((x) => x.slice()) as Card[][];
  hands[seat] = hands[seat].filter((c) => c !== card);
  hands[pair.from] = sortHand([...hands[pair.from], card], h.level);
  const pairs = trib.pairs.map((p) => (p === pair ? { ...p, returned: card } : p));
  const events: EngineEvent[] = [{ t: 'returned', from: seat, to: pair.from, card }];
  const allDone = pairs.every((p) => p.returned !== null);
  let phase: GameState['phase'] = 'tributeReturn';
  let leader = h.leader;
  let turn = h.turn;
  if (allDone) {
    phase = 'playing';
    // 首出权：收到较大贡牌者；双贡同大则上局头游
    const prev = state.match.prevPlacements!;
    let best: TributePair | null = null;
    let tie = false;
    for (const p of pairs) {
      const k = orderKey(codeOf(p.card!), h.level);
      const bk = best ? orderKey(codeOf(best.card!), h.level) : -Infinity;
      if (k > bk) {
        best = p;
        tie = false;
      } else if (k === bk && best && p.from !== best.from) {
        tie = true;
      }
    }
    leader = tie ? prev[0] : (best!.to as SeatId);
    turn = leader;
  }
  return {
    ok: true,
    state: { ...state, phase, hand: { ...h, hands, tribute: { ...trib, pairs }, leader, turn } },
    events,
  };
}

/** —— 出牌 —— */
function applyPlay(state: GameState, seat: SeatId, cards: Card[], interpId: number): ApplyResult {
  const h = state.hand;
  if (!h || state.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
  if (h.turn !== seat) return { ok: false, error: '还没轮到该座位' };
  const hand = h.hands[seat];
  if (cards.length === 0) return { ok: false, error: '出牌不能为空' };
  for (const c of cards) {
    if (!hand.includes(c)) return { ok: false, error: '所出牌不在手中（或重复）' };
  }
  const interps = interpret(cards, { level: h.level, rules: state.rules });
  if (interps.length === 0) return { ok: false, error: '无法识别的牌型' };
  if (interpId < 0 || interpId >= interps.length) return { ok: false, error: '解释编号无效' };
  const interp = interps[interpId];
  if (h.last && !beats(interp.shape, h.last.shape)) {
    return { ok: false, error: '该解释压不过上家' };
  }
  const events: EngineEvent[] = [
    { t: 'played', seat, cards, shape: interp.shape, wilds: interp.wilds },
  ];
  const hands = h.hands.map((x) => x.slice()) as Card[][];
  hands[seat] = hands[seat].filter((c) => !cards.includes(c));
  const placements = h.placements.slice();
  const out = hands[seat].length === 0;
  if (out) {
    placements.push(seat);
    events.push({ t: 'playerOut', seat, place: placements.length });
  }
  const last = { seat, cards, shape: interp.shape, wilds: interp.wilds };
  const currentTrick = [...h.currentTrick, { seat, cards, shape: interp.shape, wilds: interp.wilds, pass: false }];
  const stream = [...h.stream, { seat, cards, shape: interp.shape, wilds: interp.wilds }];

  // 三游产生即本局结束（末游为剩余者）
  if (placements.length === 3) {
    const remaining = ([0, 1, 2, 3] as SeatId[]).filter((s) => !placements.includes(s))[0];
    placements.push(remaining);
    const hand2: HandState = {
      ...h,
      hands,
      placements,
      last,
      currentTrick,
      stream,
      passes: 0,
    };
    const r = finishHand(state, hand2, events);
    return r;
  }

  // 轮转到下一有牌者
  const nxt = nextActive({ ...h, hands }, nextSeat(seat));
  if (nxt === null) return { ok: false, error: '内部错误：无下一个行动者' };
  return {
    ok: true,
    state: {
      ...state,
      hand: { ...h, hands, placements, last, currentTrick, stream, passes: 0, turn: nxt },
    },
    events,
  };
}

/** —— 过牌（仅跟牌可过） —— */
function applyPass(state: GameState, seat: SeatId): ApplyResult {
  const h = state.hand;
  if (!h || state.phase !== 'playing') return { ok: false, error: '当前不在出牌阶段' };
  if (h.turn !== seat) return { ok: false, error: '还没轮到该座位' };
  if (!h.last) return { ok: false, error: '首出必须出牌' };
  if (h.hands[seat].length === 0) return { ok: false, error: '已出完牌' };
  const events: EngineEvent[] = [{ t: 'passed', seat }];
  const currentTrick = [...h.currentTrick, { seat, cards: [], shape: null, wilds: [], pass: true }];
  const passes = h.passes + 1;
  const actives = activeSeats(h);
  // 本轮结束条件：仍持牌者全部过牌。最后一手出牌者已离场时，需要 actives 个 pass；
  // 仍在场时其自身不再行动，需要 actives - 1 个。
  const lastOut = h.hands[h.last.seat].length === 0;
  const needed = lastOut ? actives.length : actives.length - 1;

  if (passes >= needed) {
    // 本轮结束
    const winner = h.last.seat;
    events.push({ t: 'trickWon', seat: winner });
    // 接风：赢家已离场 → 出牌权给对家（对家离场则顺时针下一位未离场者）
    let target = winner;
    if (h.hands[winner].length === 0) {
      const partner = partnerOf(winner);
      const nxt = nextActive(h, partner);
      if (nxt === null) return { ok: false, error: '内部错误：接风无目标' };
      events.push({ t: 'jiefeng', from: winner, to: nxt });
      target = nxt;
    }
    return {
      ok: true,
      state: {
        ...state,
        hand: {
          ...h,
          passes: 0,
          last: null,
          currentTrick: [],
          leader: target,
          turn: target,
        },
      },
      events,
    };
  }
  const nxt = nextActive(h, nextSeat(seat))!;
  return {
    ok: true,
    state: { ...state, hand: { ...h, passes, currentTrick, turn: nxt } },
    events,
  };
}

/** —— 结算与升级 —— */
function finishHand(state: GameState, hand: HandState, events: EngineEvent[]): ApplyResult {
  const placements = hand.placements; // 4 元素
  const winnerTeam = teamOf(placements[0]);
  const partnerPlace = placements.findIndex((s) => s === partnerOf(placements[0])) + 1;
  const ups = state.rules.levelUps;
  const levelUp = partnerPlace === 2 ? ups.doubleDown : partnerPlace === 3 ? ups.oneThree : ups.oneFour;
  const oldLevels = state.match.levels;
  const newLevel = Math.min(A_LEVEL, hand.level + levelUp) as RankCode;
  const levels: [RankCode, RankCode] = [...oldLevels] as [RankCode, RankCode];
  levels[winnerTeam] = newLevel;
  events.push({ t: 'handResult', placements, winnerTeam, levelUp, newLevel });

  // 过 A：在 A 级获胜（any：任意赢；doubleDown：须双下）
  const playingAtA = hand.level === A_LEVEL;
  const passA =
    playingAtA && (state.rules.passA === 'any' || partnerPlace === 2);
  let phase: GameState['phase'] = 'handOver';
  if (passA) {
    phase = 'matchOver';
    events.push({ t: 'matchOver', winner: winnerTeam });
  }
  return {
    ok: true,
    state: {
      ...state,
      phase,
      match: { ...state.match, levels, prevPlacements: placements.slice(), winner: passA ? winnerTeam : null },
      hand: { ...hand, turn: placements[3] },
    },
    events,
  };
}

/** 该座位当前需贡的牌（进贡阶段合法动作集合） */
export function tributableCards(state: GameState, seat: SeatId): Card[] {
  const h = state.hand;
  if (!h || state.phase !== 'tribute' || !h.tribute) return [];
  const pair = h.tribute.pairs.find((p) => p.from === seat && p.card === null);
  if (!pair) return [];
  const cands = h.hands[seat].filter((c) => !isWildCard(c, h.level));
  const maxKey = Math.max(...cands.map((c) => orderKey(codeOf(c), h.level)));
  return cands.filter((c) => orderKey(codeOf(c), h.level) === maxKey);
}

/** 该座位当前可还的牌（还贡阶段合法动作集合） */
export function returnableCards(state: GameState, seat: SeatId): Card[] {
  const h = state.hand;
  if (!h || state.phase !== 'tributeReturn' || !h.tribute) return [];
  const pair = h.tribute.pairs.find((p) => p.to === seat && p.returned === null);
  if (!pair) return [];
  return h.hands[seat].filter((c) => !isWildCard(c, h.level) && codeOf(c) <= 10 && !isJokerCode(codeOf(c)));
}

/** 下一个该行动的座位（AI 调度 / 驱动循环用） */
export function actorSeat(state: GameState): SeatId {
  if (state.phase !== 'tribute' && state.phase !== 'tributeReturn' && state.phase !== 'playing') {
    return 0;
  }
  const h = state.hand!;
  if (state.phase === 'tribute') {
    const p = h.tribute!.pairs.find((pp) => pp.card === null);
    return p ? p.from : 0;
  }
  if (state.phase === 'tributeReturn') {
    const p = h.tribute!.pairs.find((pp) => pp.returned === null);
    return p ? p.to : 0;
  }
  return h.turn;
}
