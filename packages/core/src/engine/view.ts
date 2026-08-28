import type { Card, RankCode } from '../card';
import type { Shape } from '../shape';
import type { RulesConfig } from '../rules';
import type { SeatId, TeamId } from '../types';
import type { WildAssignment } from '../recognizer';
import type { GameState, Phase, TrickPlay } from './state';

/** 按座位裁剪后的视图（UI 与 AI 的唯一信息来源——天然防作弊） */
export interface GameView {
  you: SeatId;
  phase: Phase;
  rules: RulesConfig;
  handNo: number;
  level: RankCode;
  levels: [RankCode, RankCode];
  /** 自己手牌 */
  hand: Card[];
  handCounts: [number, number, number, number];
  turn: SeatId;
  leader: SeatId;
  /** 当前轮需压过的最后一手；领出时为 null */
  last: { seat: SeatId; cards: Card[]; shape: Shape; wilds: WildAssignment[] } | null;
  /** 本轮各家动作（pass 项 cards 为空） */
  trickPlays: TrickPlay[];
  placements: SeatId[];
  prevPlacements: SeatId[] | null;
  tribute:
    | {
        kind: 'single' | 'double';
        resisted: boolean;
        pairs: { from: SeatId; to: SeatId; card: Card | null; returned: Card | null }[];
        youOweTribute: boolean;
        youOweReturn: boolean;
      }
    | null;
  /** 全局出牌流水（公开信息，记牌器用） */
  stream: { seat: SeatId; cards: Card[]; shape: Shape; wilds: WildAssignment[] }[];
  winner: TeamId | null;
}

export function viewOf(state: GameState, seat: SeatId): GameView {
  const h = state.hand;
  const reveal = state.rules.revealTribute;
  return {
    you: seat,
    phase: state.phase,
    rules: state.rules,
    handNo: state.match.handNo,
    level: h?.level ?? 2,
    levels: state.match.levels,
    hand: h ? h.hands[seat] : [],
    handCounts: h
      ? ([0, 1, 2, 3].map((s) => h.hands[s].length) as [number, number, number, number])
      : [0, 0, 0, 0],
    turn: h?.turn ?? 0,
    leader: h?.leader ?? 0,
    last: h?.last ?? null,
    trickPlays: h?.currentTrick ?? [],
    placements: h?.placements ?? [],
    prevPlacements: state.match.prevPlacements,
    tribute: h?.tribute
      ? {
          kind: h.tribute.kind,
          resisted: h.tribute.resisted,
          pairs: h.tribute.pairs.map((p) => ({
            from: p.from,
            to: p.to,
            // R9：不公开时只显示与自己相关的贡/还
            card:
              reveal || p.from === seat || p.to === seat || p.card === null ? p.card : null,
            returned:
              reveal || p.from === seat || p.to === seat || p.returned === null
                ? p.returned
                : null,
          })),
          youOweTribute:
            state.phase === 'tribute' &&
            h.tribute.pairs.some((p) => p.from === seat && p.card === null),
          youOweReturn:
            state.phase === 'tributeReturn' &&
            h.tribute.pairs.some((p) => p.to === seat && p.returned === null),
        }
      : null,
    stream: h?.stream ?? [],
    winner: state.match.winner,
  };
}
