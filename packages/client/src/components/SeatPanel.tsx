import { teamOf, type GameView, type SeatId } from '@guandan/core';
import { SEAT_NAMES, SEAT_POS, placementLabel } from '../lib/ui';

/** 其他三家的座位面板：名字、剩牌数、队伍色、回合高亮、名次 */
export function SeatPanel({ view, seat }: { view: GameView; seat: SeatId }) {
  const place = view.placements.indexOf(seat);
  const isTurn = view.phase === 'playing' && view.turn === seat && place < 0;
  const team = teamOf(seat);
  const count = view.handCounts[seat];
  return (
    <div className={`seat ${SEAT_POS[seat]}${isTurn ? ' turn' : ''}`}>
      <span className={`seat-dot ${team === 0 ? 'blue' : 'red'}`} />
      <div>
        <div className="seat-name">{SEAT_NAMES[seat]}</div>
        <div className="seat-count">{place >= 0 ? placementLabel(place + 1) : `剩 ${count} 张`}</div>
      </div>
      {place < 0 && (
        <div className="seat-cards">
          {Array.from({ length: Math.min(count, 13) }).map((_, i) => (
            <span key={i} className="mini" />
          ))}
          {count > 13 && <span style={{ marginLeft: 4, fontSize: 12, color: '#b9ac8f' }}>…</span>}
        </div>
      )}
    </div>
  );
}
