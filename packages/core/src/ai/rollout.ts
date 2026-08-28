import {
  FULL_DECK,
  codeOf,
  orderKey,
  sortHand,
  type Card,
  type RankCode,
} from '../card';
import { keyOf, type Shape } from '../shape';
import { applyAction, actorSeat, type Action } from '../engine/engine';
import type { GameState } from '../engine/state';
import type { GameView } from '../engine/view';
import { teamOf, type SeatId } from '../types';
import type { Rng } from '../rng';

/** 参与 rollout 的候选动作：cards 为空表示过牌 */
export interface RolloutMove {
  cards: Card[];
  interpId: number;
  pass: boolean;
}

/**
 * 采样三个对手的暗牌：把「不在我手里、也没打出过」的牌按各座剩余张数随机发。
 * 返回 4 份手牌（我 = view.you 那份保持原样）。
 */
export function sampleOpponents(view: GameView, rng: Rng): Card[][] {
  const mine = new Set(view.hand);
  const played = new Set(view.stream.flatMap((r) => r.cards));
  const pool = FULL_DECK.filter((c) => !mine.has(c) && !played.has(c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hands: Card[][] = [[], [], [], []];
  hands[view.you] = view.hand.slice();
  let idx = 0;
  for (let seat = 0; seat < 4; seat++) {
    if (seat === view.you) continue;
    const n = view.handCounts[seat];
    hands[seat] = sortHand(pool.slice(idx, idx + n), view.level);
    idx += n;
  }
  return hands;
}

/** trickPlays 尾部连续的 pass 数 = 引擎内部 h.passes（公开信息，无需改协议） */
function trailingPasses(trick: { pass: boolean }[]): number {
  let n = 0;
  for (let i = trick.length - 1; i >= 0; i--) {
    if (trick[i].pass) n++;
    else break;
  }
  return n;
}

/** 用采样出的四份手牌重建一个可喂给 applyAction 的 GameState（当前手牌中） */
function buildSimState(view: GameView, hands: Card[][]): GameState {
  return {
    phase: 'playing',
    rules: view.rules,
    match: {
      levels: view.levels,
      handNo: view.handNo,
      prevPlacements: view.prevPlacements,
      winner: view.winner,
    },
    hand: {
      level: view.level,
      hands,
      leader: view.leader,
      turn: view.turn,
      last: view.last
        ? {
            seat: view.last.seat,
            cards: view.last.cards,
            shape: view.last.shape,
            wilds: view.last.wilds,
          }
        : null,
      passes: trailingPasses(view.trickPlays),
      placements: view.placements.slice(),
      currentTrick: [],
      stream: [],
      tribute: null,
    },
  };
}

/** 最小能压过 target 的单张/对子/三张（保证合法；复杂牌型一律不压），压不过返回 null */
function cheapBeat(hand: Card[], target: Shape, level: RankCode): Card[] | null {
  const need = target.k === 'single' ? 1 : target.k === 'pair' ? 2 : target.k === 'trio' ? 3 : 0;
  if (need === 0) return null;
  const byCode = new Map<number, number>();
  for (const c of hand) {
    const code = codeOf(c);
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  let bestCode = -1;
  for (const [code, n] of byCode) {
    if (n >= need && orderKey(code, level) > keyOf(target)) {
      if (bestCode < 0 || orderKey(code, level) < orderKey(bestCode, level)) bestCode = code;
    }
  }
  if (bestCode < 0) return null;
  let taken = 0;
  const cards: Card[] = [];
  for (const c of hand) {
    if (codeOf(c) === bestCode && taken < need) {
      cards.push(c);
      taken++;
    }
  }
  return cards;
}

/** 廉价 rollout 策略：领出最小单张，跟牌压最小能压的单/对/三，其余过 */
function cheapAction(seat: SeatId, hand: Card[], target: Shape | null, level: RankCode): Action {
  if (target === null) {
    if (hand.length === 0) return { t: 'pass', seat };
    let smallest = hand[0];
    for (const c of hand) {
      if (orderKey(codeOf(c), level) < orderKey(codeOf(smallest), level)) smallest = c;
    }
    return { t: 'play', seat, cards: [smallest], interpId: 0 };
  }
  const cards = cheapBeat(hand, target, level);
  return cards ? { t: 'play', seat, cards, interpId: 0 } : { t: 'pass', seat };
}

/** 从给定状态起，用廉价策略把当前手牌打完（或到步数上限） */
function playout(state: GameState, rng: Rng, maxSteps: number): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    if (s.phase !== 'playing') break;
    const seat = actorSeat(s);
    const hand = s.hand!.hands[seat];
    const target = s.hand!.last?.shape ?? null;
    const action = cheapAction(seat, hand, target, s.hand!.level);
    const res = applyAction(s, action, rng);
    if (!res.ok) break; // 理论上不会（廉价策略保证合法）
    s = res.state;
  }
  return s;
}

/** 以我队名次给对局结果打分（越高越好：双下 5，头游三游 3 等）；未打完用手牌张数近似 */
function scoreState(state: GameState, you: SeatId): number {
  const h = state.hand;
  if (!h) return 0;
  if (h.placements.length === 4) {
    const myTeam = teamOf(you);
    let sum = 0;
    for (let i = 0; i < 4; i++) if (teamOf(h.placements[i]) === myTeam) sum += i + 1;
    return 8 - sum;
  }
  const myTeam = teamOf(you);
  let score = 0;
  for (let seat = 0; seat < 4; seat++) {
    const n = h.hands[seat].length;
    if (teamOf(seat as SeatId) === myTeam) score -= n; // 我队越少越好
    else score += n; // 对手越多越好
  }
  return score;
}

export interface RolloutOpts {
  samples?: number;
  maxSteps?: number;
}

/** 对候选动作做 MC rollout，返回最优动作的下标（同一采样世界下公平比较） */
export function rolloutBest(
  view: GameView,
  moves: RolloutMove[],
  rng: Rng,
  opts: RolloutOpts = {},
): number {
  const samples = opts.samples ?? 5;
  const maxSteps = opts.maxSteps ?? 80;
  const scores = new Array<number>(moves.length).fill(0);
  for (let s = 0; s < samples; s++) {
    const hands = sampleOpponents(view, rng);
    for (let mi = 0; mi < moves.length; mi++) {
      const state = buildSimState(view, hands);
      const m = moves[mi];
      const res = m.pass
        ? applyAction(state, { t: 'pass', seat: view.you }, rng)
        : applyAction(
            state,
            { t: 'play', seat: view.you, cards: m.cards, interpId: m.interpId },
            rng,
          );
      if (!res.ok) {
        scores[mi] -= 1000; // 候选非法（理论不发生）
        continue;
      }
      scores[mi] += scoreState(playout(res.state, rng, maxSteps), view.you);
    }
  }
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
  return best;
}