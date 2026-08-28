import { SHAPE_LABELS, orderKey, sizeOfShape, tierOf } from '@guandan/core';
import { CardView } from './CardView';
import { keyToLabel } from '../lib/ui';
import { useGame } from '../store';

const TIER_LABELS = ['普通', '炸弹', '同花顺', '炸弹', '天王炸'];

/** 多义解释选择（逢人配歧义，如 999带88 / 888带99）：列出全部解释，最强在前 */
export function InterpretDialog({ level }: { level: number }) {
  const pending = useGame((s) => s.pendingInterp);
  const driver = useGame((s) => s.driver);
  const view = useGame((s) => s.view);
  if (!pending || !driver || !view) return null;

  const confirm = (id: number) => {
    driver.dispatch({ t: 'play', seat: view.you, cards: pending.cards, interpId: id });
    useGame.getState().setPendingInterp(null);
    useGame.getState().clearSelect();
  };

  return (
    <div className="overlay">
      <div className="dialog">
        <h3>请选择牌型解释</h3>
        <div className="hint">同样的牌有不同的打法，选择你要的解释</div>
        <div className="interp-list">
          {pending.choices.map((c) => (
            <div key={c.id} className="interp-item" onClick={() => confirm(c.id)}>
              <div style={{ display: 'flex', gap: 3 }}>
                {pending.cards.map((card) => (
                  <CardView key={card} card={card} level={level} small />
                ))}
              </div>
              <div style={{ textAlign: 'left', marginLeft: 8 }}>
                <div style={{ color: '#e8cd8b', fontWeight: 700 }}>
                  {SHAPE_LABELS[c.shape.k]}
                  {c.shape.k !== 'jokerBomb' && `（${keyToLabel(c.shape.key, level)}）`}
                </div>
                <div style={{ fontSize: 12, color: '#b9ac8f' }}>
                  {sizeOfShape(c.shape)} 张 · {TIER_LABELS[tierOf(c.shape)]}
                  {c.wilds.length > 0 &&
                    ` · 配当${c.wilds.map((w) => keyToLabel(orderKey(w.asCode, level), level)).join('/')}`}
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn small"
          style={{ marginTop: 14 }}
          onClick={() => useGame.getState().setPendingInterp(null)}
        >
          取消
        </button>
      </div>
    </div>
  );
}
