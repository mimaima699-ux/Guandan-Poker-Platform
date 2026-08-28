import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { BotLevel, RoomStateMsg } from '@guandan/core';
import { OnlineDriver } from '../driver/online';
import { ChatPanel } from '../components/ChatPanel';
import { ReconnectBanner } from '../components/ReconnectBanner';
import { useGame } from '../store';

const SEAT_TITLES = ['南 · 我方', '东 · 对方', '北 · 我方', '西 · 对方'];

/** 联机房间页：座位/补机器人/准备/开始 */
export function RoomPage() {
  const { roomId: paramRoomId } = useParams();
  const navigate = useNavigate();
  const driver = useGame((s) => s.driver);
  const [rs, setRs] = useState<RoomStateMsg | null>(null);
  const [botLevel, setBotLevel] = useState<BotLevel>('normal');
  const [useLlm, setUseLlm] = useState(false);

  useEffect(() => {
    if (!driver || driver.mode !== 'online') {
      navigate('/');
      return;
    }
    const d = driver as OnlineDriver;
    d.onRoomState = (state) => setRs({ ...state });
    if (d.roomState) setRs({ ...d.roomState });
    return () => {
      d.onRoomState = undefined;
    };
  }, [driver, navigate]);

  // 牌局开始 → 进牌桌
  useEffect(() => {
    if (rs?.started) navigate('/table');
  }, [rs?.started, navigate]);

  if (!driver || driver.mode !== 'online') return null;
  const d = driver as OnlineDriver;
  const mySeat = d.mySeat;
  const amHost = rs ? mySeat === rs.host : false;
  const myReady = rs?.seats[mySeat]?.ready ?? false;

  const leave = () => {
    d.leaveRoom();
    useGame.getState().unbind();
    navigate('/');
  };

  return (
    <div className="room-grid">
      <ReconnectBanner />
      <div className="room-panel">
        <h3 style={{ color: '#e8cd8b', letterSpacing: 4, margin: 0 }}>联机房间</h3>
        <div className="room-id">{rs?.roomId ?? paramRoomId ?? '····'}</div>
        <div className="hint" style={{ color: '#b9ac8f', fontSize: 13 }}>
          把房间号告诉好友，在大厅“加入房间”输入即可同桌
          {rs ? ` · ${rs.spectators} 人观战` : ''}
        </div>
        <div className="room-seats">
          {(rs?.seats ?? Array.from({ length: 4 }, (_, seat) => ({ seat, kind: 'open' as const }))).map(
            (s) => (
              <div key={s.seat} className="room-seat">
                <div className="seat-title">
                  {SEAT_TITLES[s.seat]}
                  {rs?.host === s.seat ? ' · 房主' : ''}
                </div>
                <div className="who">
                  {s.kind === 'open' ? (
                    amHost ? (
                      <button className="btn small" onClick={() => d.addBot(s.seat, botLevel, useLlm)}>
                        + 添加机器人
                      </button>
                    ) : (
                      <span style={{ color: '#7a8f80' }}>空位</span>
                    )
                  ) : (
                    <>
                      {s.name || '玩家'}
                      {s.kind === 'human' && <span className={`ready-dot ${s.ready ? 'on' : 'off'}`} />}
                    </>
                  )}
                </div>
                {amHost && s.kind === 'bot' && rs && !rs.started && (
                  <button
                    className="btn small"
                    style={{ marginTop: 8 }}
                    onClick={() => d.removeBot(s.seat)}
                  >
                    移除
                  </button>
                )}
              </div>
            ),
          )}
        </div>
        {amHost && (
          <div className="lobby-row" style={{ marginBottom: 12 }}>
            <span style={{ color: '#b9ac8f', fontSize: 13 }}>机器人难度</span>
            <div className="seg">
              {(['easy', 'normal', 'hard', 'expert'] as BotLevel[]).map((b) => (
                <button key={b} className={botLevel === b ? 'on' : ''} onClick={() => setBotLevel(b)}>
                  {b === 'easy' ? '简单' : b === 'hard' ? '困难' : b === 'expert' ? '专家' : '普通'}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#b9ac8f', fontSize: 13 }}>
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
              用 Qwen 选牌
            </label>
          </div>
        )}
        <div className="lobby-row">
          {rs && !rs.started && !amHost && (
            <button className="btn" onClick={() => d.setReady(!myReady)}>
              {myReady ? '取消准备' : '准备'}
            </button>
          )}
          {amHost && rs && !rs.started && (
            <button
              className="btn primary"
              onClick={() => d.startGame()}
              disabled={rs.seats.some((s) => s.kind === 'open')}
            >
              开始游戏
            </button>
          )}
          <button className="btn" onClick={leave}>
            离开房间
          </button>
        </div>
        <ChatPanel />
      </div>
    </div>
  );
}
