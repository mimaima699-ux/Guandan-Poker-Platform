import { codeLabel, teamOf, type GameView, type SeatId } from '@guandan/core';
import { useNavigate } from 'react-router';
import { SEAT_NAMES, TEAM_NAMES, placementLabel } from '../lib/ui';
import { buildLocalBrains, useGame } from '../store';
import { LocalDriver } from '../driver/local';

/** 本局结算 / 整场胜负浮层 */
export function ResultOverlay({ view }: { view: GameView }) {
  const navigate = useNavigate();
  const driver = useGame((s) => s.driver);
  const localBotLevels = useGame((s) => s.localBotLevels);
  const localUseLlm = useGame((s) => s.localUseLlm);
  const localLlmUrl = useGame((s) => s.localLlmUrl);
  const localLlmModel = useGame((s) => s.localLlmModel);
  if (!driver || (view.phase !== 'handOver' && view.phase !== 'matchOver')) return null;

  const winnerTeam = teamOf(view.placements[0] ?? view.you);
  const matchWinner = view.winner;

  const nextHand = () => driver.dispatch({ t: 'deal' });

  const restart = () => {
    if (driver.mode !== 'local') return;
    useGame.getState().clearRecording();
    const d = new LocalDriver(buildLocalBrains(localBotLevels, localUseLlm, localLlmUrl, localLlmModel));
    useGame.getState().bind(d);
    d.start();
  };

  const backHome = () => {
    useGame.getState().unbind();
    location.href = '/';
  };

  return (
    <div className="overlay">
      <div className="dialog">
        {view.phase === 'matchOver' ? (
          <>
            <h3>比赛结束</h3>
            <div className="hint" style={{ fontSize: 20, color: matchWinner === teamOf(view.you) ? '#8fe08f' : '#e08f8f' }}>
              {TEAM_NAMES[matchWinner ?? 0]}获胜
              {matchWinner === teamOf(view.you) ? ' · 胜利！' : ' · 再接再厉'}
            </div>
          </>
        ) : (
          <>
            <h3>本局结束</h3>
            <div className="hint">
              {TEAM_NAMES[winnerTeam]}赢下本局 · 当前级数：我方打 {codeLabel(view.levels[teamOf(view.you)])} / 对方打{' '}
              {codeLabel(view.levels[1 - teamOf(view.you)])}
            </div>
          </>
        )}
        <div className="result-placements">
          {view.placements.map((seat, i) => (
            <div key={seat} className={`result-seat${i === 0 ? ' first' : ''}`}>
              <div style={{ color: teamOf(seat as SeatId) === 0 ? '#5b8fd6' : '#d24b4b' }}>
                {SEAT_NAMES[seat as SeatId]}
              </div>
              <div style={{ color: '#e8cd8b', fontWeight: 700 }}>{placementLabel(i + 1)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {view.phase === 'handOver' && (
            <button className="btn primary" onClick={nextHand}>
              下一局
            </button>
          )}
          {view.phase === 'matchOver' && driver.mode === 'local' && (
            <button className="btn primary" onClick={restart}>
              再来一场
            </button>
          )}
          {view.phase === 'matchOver' && (
            <button className="btn" onClick={() => navigate('/replay')}>
              回放本局
            </button>
          )}
          <button className="btn" onClick={backHome}>
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}
