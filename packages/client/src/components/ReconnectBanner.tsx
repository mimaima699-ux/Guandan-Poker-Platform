import { useGame } from '../store';

/** 联机断线提示条：连接断开时显示，自动重连成功后消失 */
export function ReconnectBanner() {
  const driver = useGame((s) => s.driver);
  const connected = useGame((s) => s.onlineConnected);
  if (!driver || driver.mode !== 'online' || connected) return null;
  return <div className="reconnect-banner">连接断开，正在自动重连…</div>;
}