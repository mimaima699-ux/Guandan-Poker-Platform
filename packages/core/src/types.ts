/** 基础类型别名 */
export type SeatId = 0 | 1 | 2 | 3;
export type TeamId = 0 | 1;

/** 队友（对家）座位：0↔2, 1↔3 */
export function partnerOf(seat: SeatId): SeatId {
  return ((seat + 2) % 4) as SeatId;
}

/** 队伍：0&2 为一队，1&3 为一队 */
export function teamOf(seat: SeatId): TeamId {
  return (seat % 2) as TeamId;
}

/** 下一个座位（顺时针） */
export function nextSeat(seat: SeatId): SeatId {
  return ((seat + 1) % 4) as SeatId;
}
