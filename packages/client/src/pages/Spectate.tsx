import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { codeLabel, type SeatId } from '@guandan/core';
import { useGame } from '../store';
import { OnlineDriver } from '../driver/online';
import { SeatPanel } from '../components/SeatPanel';
import { TrickArea } from '../components/TrickArea';
import { CardView } from '../components/CardView';
import { ChatPanel } from '../components/ChatPanel';
import { ReconnectBanner } from '../components/ReconnectBanner';

const SEAT_NAMES = ['我', '右家', '对家', '左家'];

/** 观战页：只读牌桌 + 视角切换 + 聊天（默认不占座、不泄露手牌） */
export function SpectatePage() {
  const navigate = useNavigate();
  const driver = useGame((s) => s.driver);
  const view = useGame((s) => s.view);
  const [specSeat, setSpecSeat] = useState(-1);

  useEffect(() => {
    if (!driver || driver.mode !== 'online') {
      navigate('/');
      return;
    }
    const d = driver as OnlineDriver;
    if (d.mySeat !== -1) navigate('/');
  }, [driver, navigate]);

  if (!driver || driver.mode !== 'online' || !view) return null;
  const d = driver as OnlineDriver;

  const pickSeat = (seat: number) => {
    setSpecSeat(seat);
    d.setSpectateSeat(seat);
  };

  const leave = () => {
    d.leaveRoom();
    useGame.getState().unbind();
    navigate('/');
  };

  const viewingHand = view.you >= 0;

  return (
    <div className="spectate-root">
      <ReconnectBanner />
      <div className="hudbar">
        <div className="levels">
          <span className="level-chip">观战中 · 房间 {d.roomId ?? '····'}</span>
          <span className="level-chip">第 {view.handNo} 局 · 打 {codeLabel(view.level)}</span>
        </div>
        <button className="btn small" onClick={leave}>退出观战</button>
      </div>

      <div className="spectate-toolbar">
        <span className="label">视角：</span>
        <button className={`btn small${specSeat === -1 ? ' on' : ''}`} onClick={() => pickSeat(-1)}>
          隐藏手牌
        </button>
        {([0, 1, 2, 3] as SeatId[]).map((s) => (
          <button key={s} className={`btn small${specSeat === s ? ' on' : ''}`} onClick={() => pickSeat(s)}>
            {SEAT_NAMES[s]}
          </button>
        ))}
      </div>

      <div className="table-board spectate-board">
        <SeatPanel view={view} seat={2 as SeatId} />
        <SeatPanel view={view} seat={1 as SeatId} />
        <SeatPanel view={view} seat={3 as SeatId} />
        <TrickArea view={view} />
        <div className="spectate-tag">观 战</div>
      </div>

      {viewingHand && (
        <div className="hand-area">
          <div style={{ color: '#e8cd8b', fontSize: 13, marginBottom: -10 }}>
            正在看「{SEAT_NAMES[view.you as SeatId]}」的手牌
          </div>
          <div className="hand">
            {view.hand.map((c) => (
              <CardView key={c} card={c} level={view.level} />
            ))}
          </div>
        </div>
      )}

      <ChatPanel />
    </div>
  );
}