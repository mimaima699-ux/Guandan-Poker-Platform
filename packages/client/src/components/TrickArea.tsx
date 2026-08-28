import { SHAPE_LABELS, codeLabel, sortHand, type GameView, type SeatId } from '@guandan/core';
import { CardView } from './CardView';
import { SEAT_NAMES, SEAT_POS } from '../lib/ui';

/** 中央出牌区：每座仅显示「最近一次」动作（同轮加码再出时旧牌被顶掉，避免堆叠） */
export function TrickArea({ view }: { view: GameView }) {
  // 同一轮内有人可能多次出牌（加注）：按座位去重保留最后一次
  const latest = new Map<SeatId, (typeof view.trickPlays)[number]>();
  for (const p of view.trickPlays) latest.set(p.seat as SeatId, p);
  const plays = [...latest.values()];

  return (
    <div className="trick">
      <div className="trick-inner">
        {plays.map((p) => {
          const pos = SEAT_POS[p.seat as SeatId];
          const wildAs = p.wilds
            .filter((w) => w.asCode !== view.level || p.wilds.length === 0)
            .map((w) => codeLabel(w.asCode))
            .join('/');
          return (
            <div key={`${p.seat}`} className={`trick-play ${pos}`}>
              <span className="who">{SEAT_NAMES[p.seat as SeatId]}</span>
              {p.pass ? (
                <span className="pass-mark">不要</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {sortHand(p.cards, view.level).map((c) => (
                      <CardView key={c} card={c} level={view.level} small />
                    ))}
                  </div>
                  <div className="shape-tag">
                    {p.shape ? SHAPE_LABELS[p.shape.k] : ''}
                    {wildAs && p.wilds.length > 0 ? ` · 配当${wildAs}` : ''}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {plays.length === 0 && view.last === null && view.phase === 'playing' && (
          <div style={{ placeSelf: 'center', color: '#b9ac8f', fontSize: 14 }}>
            {SEAT_NAMES[view.leader as SeatId]} 出牌
          </div>
        )}
      </div>
    </div>
  );
}
