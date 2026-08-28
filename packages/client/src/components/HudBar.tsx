import { codeLabel, teamOf, type GameView } from '@guandan/core';
import { useNavigate } from 'react-router';
import { TEAM_NAMES } from '../lib/ui';
import { useGame } from '../store';

/** 顶栏：两队级数、本局级牌、局数、模式、退出 */
export function HudBar({ view, mode }: { view: GameView; mode: 'local' | 'online' }) {
  const navigate = useNavigate();
  const driver = useGame((s) => s.driver);
  const myTeam = teamOf(view.you);

  const onQuit = () => {
    if (!confirm('确定要退出当前游戏吗？')) return;
    if (driver?.leave) driver.leave(); // 联机：通知服务器离开房间
    useGame.getState().unbind();
    navigate('/');
  };

  return (
    <div className="hudbar">
      <div className="levels">
        <span className={`level-chip ${myTeam === 0 ? 'team-blue' : 'team-red'}`}>
          {TEAM_NAMES[myTeam]}（我与对家）· 打 {codeLabel(view.levels[myTeam])}
        </span>
        <span className={`level-chip ${myTeam === 0 ? 'team-red' : 'team-blue'}`}>
          {TEAM_NAMES[1 - myTeam]} · 打 {codeLabel(view.levels[1 - myTeam])}
        </span>
        <span className="level-chip">本局级牌：{codeLabel(view.level)}</span>
        <span className="level-chip">第 {view.handNo} 局</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ color: '#b9ac8f', fontSize: 13 }}>{mode === 'local' ? '单机模式' : '联机模式'}</span>
        <button className="btn small quit-btn" onClick={onQuit}>
          退出
        </button>
      </div>
    </div>
  );
}
