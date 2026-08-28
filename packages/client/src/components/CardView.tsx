import { memo } from 'react';
import { SUIT_SYMBOLS, codeLabel, codeOf, isJoker, isWildCard, suitOf, type Card, type RankCode } from '@guandan/core';

export interface CardViewProps {
  card: Card;
  level: RankCode;
  selected?: boolean;
  dim?: boolean;
  small?: boolean;
  onClick?: () => void;
}

/** 单张扑克牌（纯 CSS 绘制；红桃级牌带“配”金徽章） */
export const CardView = memo(function CardView({
  card,
  level,
  selected,
  dim,
  small,
  onClick,
}: CardViewProps) {
  const code = codeOf(card);
  const suit = suitOf(card);
  const joker = isJoker(card);
  const wild = isWildCard(card, level);
  const red = !joker && (suit === 0 || suit === 3);
  const cls = [
    'card',
    small ? 'sm' : '',
    joker ? 'joker' : '',
    joker ? (code === 16 ? 'big' : 'small') : red ? 'red-suit' : 'black-suit',
    wild ? 'wild-card' : '',
    selected ? 'selected' : '',
    dim ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} onClick={onClick} title={wild ? '逢人配（百搭）' : joker ? (code === 16 ? '大王' : '小王') : undefined}>
      {joker ? (
        <div className="joker-text" aria-label={code === 16 ? '大王' : '小王'}>
          {code === 16 ? '大王' : '小王'}
        </div>
      ) : (
        <>
          <div className="rk">{codeLabel(code)}</div>
          <div className="st">{SUIT_SYMBOLS[suit]}</div>
          <div className="big-suit">{SUIT_SYMBOLS[suit]}</div>
        </>
      )}
    </div>
  );
});
