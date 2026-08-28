import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { OnlineDriver } from '../driver/online';

const SEAT_LABELS = ['我', '右家', '对家', '左家'];

function speakerLabel(seat: number): string {
  if (seat < 0) return '观战';
  return SEAT_LABELS[seat] ?? `#${seat}`;
}

/** 房间/牌桌/观战共用的聊天面板 */
export function ChatPanel() {
  const driver = useGame((s) => s.driver);
  const messages = useGame((s) => s.chatMessages);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  if (!driver || driver.mode !== 'online') return null;
  const d = driver as OnlineDriver;

  const send = () => {
    const t = text.trim();
    if (!t) return;
    d.sendChat(t);
    setText('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <div className="chat-empty">来说点什么…</div>}
        {messages.map((m, i) => (
          <div key={i} className="chat-msg">
            <span className="chat-who">{speakerLabel(m.seat)}·{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          placeholder="说点什么…"
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button className="btn small" onClick={send}>发送</button>
      </div>
    </div>
  );
}