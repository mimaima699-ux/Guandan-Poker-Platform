import type { Card, RankCode } from '../card';
import type { RulesConfig } from '../rules';
import type { Shape } from '../shape';
import type { SeatId, TeamId } from '../types';
import type { WildAssignment } from '../recognizer';

/** 对局阶段 */
export type Phase =
  | 'idle' // 尚未开局
  | 'tribute' // 进贡中（含待判定；首局/抗贡时跳过）
  | 'tributeReturn' // 还贡中
  | 'playing' // 出牌中
  | 'handOver' // 一局结束（等待开下一局）
  | 'matchOver'; // 整场比赛结束

export interface MatchState {
  /** 两队各自级数（2..14） */
  levels: [RankCode, RankCode];
  handNo: number; // 第几局，从 1 起
  /** 上局名次（头游在前）；首局为 null */
  prevPlacements: SeatId[] | null;
  winner: TeamId | null;
}

export interface PlayRecord {
  seat: SeatId;
  cards: Card[];
  shape: Shape;
  wilds: WildAssignment[];
}

export interface TributePair {
  from: SeatId; // 贡家
  to: SeatId; // 收贡者
  card: Card | null; // 已贡的牌；null = 尚未贡
  returned: Card | null; // 已还的牌
}

export interface TributeState {
  kind: 'single' | 'double';
  pairs: TributePair[];
  resisted: boolean; // 抗贡成立
}

export interface TrickPlay {
  seat: SeatId;
  cards: Card[]; // pass 时空
  shape: Shape | null; // pass 时 null
  wilds: WildAssignment[];
  pass: boolean;
}

export interface HandState {
  level: RankCode; // 本局级数（按 rules.levelPolicy 从 match.levels 求得）
  hands: Card[][]; // 4 × 27（引擎内部；视图层裁剪）
  leader: SeatId; // 当前轮首出者
  turn: SeatId; // 当前行动者
  /** 当前轮需要压过的最后一手 */
  last: { seat: SeatId; cards: Card[]; shape: Shape; wilds: WildAssignment[] } | null;
  passes: number; // 连续 pass 计数
  placements: SeatId[]; // 本局已出完的座位（按名次）
  currentTrick: TrickPlay[]; // 本轮各家动作（UI 展示）
  stream: PlayRecord[]; // 全局出牌流水（记牌器/回放）
  tribute: TributeState | null;
}

export interface GameState {
  phase: Phase;
  rules: RulesConfig;
  match: MatchState;
  hand: HandState | null;
}

export type EngineEvent =
  | { t: 'dealt'; level: RankCode; leader: SeatId }
  | { t: 'tributeDue'; pairs: { from: SeatId; to: SeatId }[] }
  | { t: 'tributed'; from: SeatId; to: SeatId; card: Card }
  | { t: 'tributeResisted' }
  | { t: 'returned'; from: SeatId; to: SeatId; card: Card }
  | { t: 'played'; seat: SeatId; cards: Card[]; shape: Shape; wilds: WildAssignment[] }
  | { t: 'passed'; seat: SeatId }
  | { t: 'trickWon'; seat: SeatId }
  | { t: 'playerOut'; seat: SeatId; place: number } // 1=头游 2=二游 3=三游（4=末游隐含）
  | { t: 'jiefeng'; from: SeatId; to: SeatId }
  | { t: 'handResult'; placements: SeatId[]; winnerTeam: TeamId; levelUp: number; newLevel: RankCode }
  | { t: 'matchOver'; winner: TeamId };

export function createInitialMatch(rules: RulesConfig): GameState {
  return {
    phase: 'idle',
    rules,
    match: { levels: [2, 2], handNo: 0, prevPlacements: null, winner: null },
    hand: null,
  };
}
