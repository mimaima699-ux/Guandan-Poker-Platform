import { useRef } from 'react';
import { beatOptions, beats, interpret, leadOptions, makeCtx, type GameView } from '@guandan/core';
import { useGame } from '../store';

/** 操作条：出牌 / 不要 / 提示 / 排序切换 */
export function ActionBar({ view }: { view: GameView }) {
  const driver = useGame((s) => s.driver);
  const selected = useGame((s) => s.selected);
  const sortMode = useGame((s) => s.sortMode);
  const hintIdx = useRef(0);

  if (!driver) return null;
  const myTurn = view.phase === 'playing' && view.turn === view.you;
  const ctx = makeCtx(view.level, view.rules);
  const store = useGame.getState;

  const doPlay = (interpId: number) => {
    driver.dispatch({ t: 'play', seat: view.you, cards: selected, interpId });
    store().clearSelect();
    hintIdx.current = 0;
  };

  const onPlay = () => {
    if (selected.length === 0) return store().setToast('请先选牌');
    const interps = interpret(selected, ctx);
    if (interps.length === 0) return store().setToast('不是合法牌型');
    if (view.last) {
      const choices = interps
        .map((i, id) => ({ id, ...i }))
        .filter((i) => beats(i.shape, view.last!.shape));
      if (choices.length === 0) return store().setToast('压不过上家');
      if (choices.length === 1) return doPlay(choices[0].id);
      return store().setPendingInterp({ cards: selected.slice(), choices });
    }
    if (interps.length === 1) return doPlay(0);
    store().setPendingInterp({
      cards: selected.slice(),
      choices: interps.map((i, id) => ({ id, ...i })),
    });
  };

  const onHint = () => {
    const opts = view.last
      ? beatOptions(view.hand, view.last.shape, ctx)
      : leadOptions(view.hand, ctx);
    if (opts.length === 0) {
      store().setToast(view.last ? '要不起' : '无牌可出');
      return;
    }
    const o = opts[hintIdx.current % opts.length];
    hintIdx.current++;
    store().setSelected(o.cards);
  };

  return (
    <div className="actionbar" style={{ position: 'relative' }}>
      <div className="status">
        {view.phase === 'playing' && !myTurn && '等待其他玩家…'}
        {view.phase === 'playing' && myTurn && (view.last ? '轮到你压牌' : '轮到你出牌')}
      </div>
      <button className="btn small" onClick={() => store().toggleSort()}>
        {sortMode === 'rank' ? '按大小' : '按张数'}
      </button>
      <button className="btn" disabled={!myTurn} onClick={onHint}>
        提示
      </button>
      {view.last && myTurn && (
        <button className="btn" onClick={() => driver.dispatch({ t: 'pass', seat: view.you })}>
          不要
        </button>
      )}
      <button className="btn primary" disabled={!myTurn} onClick={onPlay}>
        出牌
      </button>
    </div>
  );
}
