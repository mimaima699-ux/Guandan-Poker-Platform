import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { codeLabel, SHAPE_LABELS, type EngineEvent, type SeatId } from '@guandan/core';
import { useGame } from '../store';
import { SeatPanel } from '../components/SeatPanel';
import { TrickArea } from '../components/TrickArea';
import { CardView } from '../components/CardView';

const SEAT_NAMES = ['我', '右家', '对家', '左家'];

/** 把最近一组引擎事件压缩成一句人话（回放字幕用） */
function caption(events: EngineEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    switch (e.t) {
      case 'played':
        return `${SEAT_NAMES[e.seat]} 出 ${SHAPE_LABELS[e.shape.k]}`;
      case 'passed':
        return `${SEAT_NAMES[e.seat]} · 不要`;
      case 'playerOut':
        return `${SEAT_NAMES[e.seat]} 出完了（第 ${e.place} 名）`;
      case 'tributed':
        return `${SEAT_NAMES[e.from]} 向 ${SEAT_NAMES[e.to]} 进贡`;
      case 'returned':
        return `${SEAT_NAMES[e.from]} 向 ${SEAT_NAMES[e.to]} 还贡`;
      case 'tributeResisted':
        return '抗贡成立，跳过进贡';
      case 'dealt':
        return '发牌';
      case 'handResult':
        return '本局结束';
      case 'matchOver':
        return '比赛结束';
      default:
        break;
    }
  }
  return '';
}

/** 牌局回放页：进度条拖动 + 跳局 + 导出/导入 + 自动播放（只读） */
export function ReplayPage() {
  const recording = useGame((s) => s.recording);
  const setToast = useGame((s) => s.setToast);
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!playing) return;
    if (idx >= recording.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + 1), 850);
    return () => clearTimeout(t);
  }, [playing, idx, recording.length]);

  // 每一局的第一帧下标（发牌帧），供「跳局」与进度标记
  const handStarts = useMemo(() => {
    const out: number[] = [];
    recording.forEach((f, i) => {
      if (f.events.some((e) => e.t === 'dealt')) out.push(i);
    });
    return out;
  }, [recording]);

  const jumpTo = (i: number) => {
    setPlaying(false);
    setIdx(Math.max(0, Math.min(recording.length - 1, i)));
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guandan-replay-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((txt) => {
        const data = JSON.parse(txt) as unknown;
        if (
          !Array.isArray(data) ||
          !data.every((f) => f && typeof f === 'object' && 'view' in f && Array.isArray((f as { events?: unknown }).events))
        ) {
          throw new Error('bad shape');
        }
        useGame.getState().setRecording(data as never);
        setIdx(0);
        setPlaying(false);
        setToast('录像已导入');
      })
      .catch(() => setToast('录像文件无效'));
    e.target.value = '';
  };

  if (recording.length === 0) {
    return (
      <div className="lobby">
        <div className="lobby-panel">
          <h3 style={{ color: '#e8cd8b' }}>没有可回放的录像</h3>
          <div className="hint" style={{ color: '#b9ac8f', marginTop: 12 }}>先打完一局，或导入录像文件</div>
          <button className="btn" onClick={() => fileRef.current?.click()}>导入录像</button>
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => navigate('/')}>返回大厅</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
        </div>
      </div>
    );
  }

  const frame = recording[Math.min(idx, recording.length - 1)];
  const view = frame.view;
  const cap = caption(frame.events);

  return (
    <div className="table-page">
      <div className="hudbar">
        <div className="levels">
          <span className="level-chip">第 {view.handNo} 局 · 打 {codeLabel(view.level)}</span>
          <span className="level-chip" style={{ color: '#e8cd8b' }}>
            {idx + 1} / {recording.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small" onClick={() => fileRef.current?.click()}>导入</button>
          <button className="btn small" onClick={onExport}>导出</button>
          <button className="btn small" onClick={() => navigate('/')}>退出回放</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImport} />
      </div>

      {/* 进度条 + 跳局标记 */}
      <div className="replay-timeline">
        <input
          type="range"
          min={0}
          max={Math.max(0, recording.length - 1)}
          value={idx}
          onChange={(e) => jumpTo(Number(e.target.value))}
        />
        <div className="replay-hands">
          {handStarts.map((start, k) => (
            <button
              key={start}
              className={`btn small${recording[start].view.handNo === view.handNo ? ' on' : ''}`}
              onClick={() => jumpTo(start)}
            >
              第 {recording[start].view.handNo} 局
            </button>
          ))}
        </div>
      </div>

      <div className="table-board">
        <SeatPanel view={view} seat={2 as SeatId} />
        <SeatPanel view={view} seat={1 as SeatId} />
        <SeatPanel view={view} seat={3 as SeatId} />
        <TrickArea view={view} />
      </div>

      <div className="hand-area">
        <div className="hand">
          {view.hand.map((c) => (
            <CardView key={c} card={c} level={view.level} />
          ))}
        </div>
      </div>

      <div className="actionbar" style={{ gap: 12 }}>
        <button className="btn small" onClick={() => { setPlaying(false); setIdx(0); }}>⏮ 开头</button>
        <button className="btn small" onClick={() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }}>◀ 上一步</button>
        <button className="btn primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button className="btn small" onClick={() => { setPlaying(false); setIdx((i) => Math.min(recording.length - 1, i + 1)); }}>下一步 ▶</button>
        <button className="btn small" onClick={() => { setPlaying(false); setIdx(recording.length - 1); }}>末尾 ⏭</button>
      </div>

      <div style={{ textAlign: 'center', color: '#b9ac8f', fontSize: 14, paddingBottom: 16, minHeight: 20 }}>
        {cap}
      </div>
    </div>
  );
}