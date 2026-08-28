import { codeLabel, codeOf } from '@guandan/core';
import { CardView } from './CardView';
import { returnableFromView, tributableFromView } from '../lib/ui';
import { useGame } from '../store';
import type { GameView } from '@guandan/core';

/** 进贡/还贡浮层：合法牌高亮可点，其余置灰 */
export function TributeOverlay({ view }: { view: GameView }) {
  const driver = useGame((s) => s.driver);
  if (!driver || !view.tribute) return null;
  const oweTribute = view.tribute.youOweTribute;
  const oweReturn = view.tribute.youOweReturn;
  if (!oweTribute && !oweReturn) return null;

  const tributable = tributableFromView(view);
  const returnable = returnableFromView(view);
  const legal = oweTribute ? tributable : returnable;

  const onPick = (card: number) => {
    if (oweTribute) driver.dispatch({ t: 'tribute', seat: view.you, card });
    else driver.dispatch({ t: 'returnTribute', seat: view.you, card });
  };

  return (
    <div className="overlay">
      <div className="dialog">
        <h3>{oweTribute ? '请进贡' : '请还贡'}</h3>
        <div className="hint">
          {oweTribute
            ? `交出手中最大的牌（${tributable.map((c) => codeLabel(codeOf(c))).join(' ')}，逢人配除外）`
            : '还给对方一张不大于 10 的牌'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560 }}>
          {view.hand.map((c) => (
            <CardView
              key={c}
              card={c}
              level={view.level}
              small
              dim={!legal.includes(c)}
              onClick={legal.includes(c) ? () => onPick(c) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
