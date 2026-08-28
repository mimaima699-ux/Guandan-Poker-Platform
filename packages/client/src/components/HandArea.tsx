import { useMemo } from 'react';
import type { Card, GameView } from '@guandan/core';
import { CardView } from './CardView';
import { sortedHand } from '../lib/ui';

/** 我的手牌：点击选牌上浮、逢人配金徽章、排序切换 */
export function HandArea({
  view,
  selected,
  sortMode,
  onToggle,
}: {
  view: GameView;
  selected: Card[];
  sortMode: 'rank' | 'count';
  onToggle: (c: Card) => void;
}) {
  const cards = useMemo(() => sortedHand(view.hand, view, sortMode), [view, sortMode]);
  const tight = cards.length > 17;
  return (
    <div className="hand-area">
      <div className={`hand${tight ? ' tight' : ''}`}>
        {cards.map((c) => (
          <CardView
            key={c}
            card={c}
            level={view.level}
            selected={selected.includes(c)}
            onClick={() => onToggle(c)}
          />
        ))}
      </div>
    </div>
  );
}
