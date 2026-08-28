import { useEffect } from 'react';
import { useGame } from '../store';

/** 全局提示气泡（1.8s 自动消失） */
export function Toast() {
  const toast = useGame((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useGame.getState().setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
