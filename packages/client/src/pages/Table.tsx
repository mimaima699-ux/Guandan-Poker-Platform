import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { SeatId } from '@guandan/core';
import { useGame } from '../store';
import { HudBar } from '../components/HudBar';
import { SeatPanel } from '../components/SeatPanel';
import { TrickArea } from '../components/TrickArea';
import { HandArea } from '../components/HandArea';
import { ActionBar } from '../components/ActionBar';
import { InterpretDialog } from '../components/InterpretDialog';
import { TributeOverlay } from '../components/TributeOverlay';
import { ResultOverlay } from '../components/ResultOverlay';
import { ReconnectBanner } from '../components/ReconnectBanner';
import { ChatPanel } from '../components/ChatPanel';
import { Toast } from '../components/Toast';

/** 牌桌页：单机与联机共用，模式由 Driver 决定 */
export function TablePage() {
  const navigate = useNavigate();
  const driver = useGame((s) => s.driver);
  const view = useGame((s) => s.view);
  const selected = useGame((s) => s.selected);
  const sortMode = useGame((s) => s.sortMode);
  const toggleCard = useGame((s) => s.toggleCard);

  useEffect(() => {
    if (!driver) navigate('/');
  }, [driver, navigate]);

  if (!driver || !view) return null;

  return (
    <div className="table-page">
      <ReconnectBanner />
      <HudBar view={view} mode={driver.mode} />
      <div className="table-board">
        <SeatPanel view={view} seat={2 as SeatId} />
        <SeatPanel view={view} seat={1 as SeatId} />
        <SeatPanel view={view} seat={3 as SeatId} />
        <TrickArea view={view} />
      </div>
      <HandArea view={view} selected={selected} sortMode={sortMode} onToggle={toggleCard} />
      <ActionBar view={view} />
      <InterpretDialog level={view.level} />
      <TributeOverlay view={view} />
      <ResultOverlay view={view} />
      <ChatPanel />
      <Toast />
    </div>
  );
}
