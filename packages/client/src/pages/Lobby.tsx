import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { BotLevel } from '@guandan/core';
import { LocalDriver } from '../driver/local';
import { OnlineDriver } from '../driver/online';
import { buildLocalBrains, useGame } from '../store';

const BOT_LABELS: Record<BotLevel, string> = { easy: '简单', normal: '普通', hard: '困难', expert: '专家' };

export function Lobby() {
  const navigate = useNavigate();
  const [bot, setBot] = useState<BotLevel>('normal');
  const [name, setName] = useState(localStorage.getItem('guandan_name') ?? '');
  const [roomId, setRoomId] = useState('');
  const [useLlm, setUseLlm] = useState(useGame.getState().localUseLlm);
  const [llmUrl, setLlmUrl] = useState(useGame.getState().localLlmUrl);
  const [llmModel, setLlmModel] = useState(useGame.getState().localLlmModel);
  const setToast = useGame((s) => s.setToast);

  const startLocal = () => {
    const levels: BotLevel[] = [bot, bot, bot];
    const url = llmUrl.trim() || 'http://localhost:11434/v1';
    const model = llmModel.trim() || 'qwen2.5:7b';
    const g = useGame.getState();
    g.setLocalBots(levels);
    g.setLocalLlm(useLlm, url, model);
    g.clearRecording();
    const driver = new LocalDriver(buildLocalBrains(levels, useLlm, url, model));
    g.bind(driver);
    driver.start();
    navigate('/table');
  };

  /** 建立联机驱动：连接 + hello（若 token 命中未结束的房间则自动回归） */
  const openOnline = (): OnlineDriver => {
    useGame.getState().unbind();
    const d = new OnlineDriver(name.trim() || '玩家');
    if (name.trim()) localStorage.setItem('guandan_name', name.trim());
    d.onError = (e) => useGame.getState().setToast(e.message);
    d.onConnection = (c) => useGame.getState().setOnlineConnected(c);
    d.onChat = (m) => useGame.getState().appendChat(m);
    d.onKicked = (reason) => {
      useGame.getState().setToast(reason);
      useGame.getState().unbind();
      navigate('/');
    };
    d.onRoomState = (rs) => {
      if (!location.pathname.startsWith('/room/') && !location.pathname.startsWith('/spectate')) {
        navigate(`/room/${rs.roomId}`);
      }
    };
    useGame.getState().bind(d);
    d.connect();
    return d;
  };

  const createRoom = () => {
    const d = openOnline();
    d.onYouAre = (seat) => {
      if (seat < 0) d.createRoom(); // 未在房间 → 新建；否则 token 已回归旧房间，onRoomState 会自动跳转
    };
  };

  const joinRoom = () => {
    const id = roomId.trim().toUpperCase();
    if (id.length !== 4) {
      setToast('请输入 4 位房间号');
      return;
    }
    const d = openOnline();
    d.onYouAre = (seat) => {
      if (seat < 0) d.joinRoom(id);
    };
  };

  const spectateRoom = () => {
    const id = roomId.trim().toUpperCase();
    if (id.length !== 4) {
      setToast('请输入 4 位房间号');
      return;
    }
    const d = openOnline();
    d.onRoomState = () => {
      if (!location.pathname.startsWith('/spectate')) navigate('/spectate');
    };
    d.onYouAre = (seat, rid) => {
      if (seat >= 0) {
        navigate(`/room/${rid ?? id}`);
        return;
      }
      if (rid === null) d.joinRoom(id, true); // 尚无房间 → 以观战者加入
    };
  };

  // 刷新后自动回归未结束的牌局（本地 token 命中服务器座位时服务器会主动下发房间与快照）
  useEffect(() => {
    const token = localStorage.getItem('guandan_token');
    if (!token) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const d = openOnline();
      d.onYouAre = (seat, rid) => {
        if (seat >= 0 && rid) {
          useGame.getState().setToast('已重新连接到对局');
        }
      };
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lobby">
      <div className="lobby-panel">
        <h1 className="lobby-title">掼 蛋</h1>
        <div className="lobby-sub">GUAN DAN · 经典四人对牌</div>

        <div className="lobby-section">
          <div style={{ color: '#b9ac8f', marginBottom: 4 }}>单机模式 · 与三位电脑玩家对战</div>
          <div className="lobby-row">
            <div className="seg">
              {(['easy', 'normal', 'hard', 'expert'] as BotLevel[]).map((b) => (
                <button key={b} className={bot === b ? 'on' : ''} onClick={() => setBot(b)}>
                  {BOT_LABELS[b]}
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={startLocal}>
              开始游戏
            </button>
          </div>
          <div className="lobby-row" style={{ alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b9ac8f' }}>
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
              电脑用本地 Qwen（更聪明，需运行 Ollama）
            </label>
          </div>
          {useLlm && (
            <>
              <div className="lobby-row">
                <input
                  className="input"
                  placeholder="Ollama 地址"
                  value={llmUrl}
                  onChange={(e) => setLlmUrl(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="模型名"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                />
              </div>
              <div style={{ color: '#7a8f80', fontSize: 12, marginTop: 6 }}>
                单机由浏览器直连 Ollama；若电脑出牌异常慢，请在启动 Ollama 时加环境变量
                <code style={{ color: '#b9ac8f' }}> OLLAMA_ORIGINS=* </code>
                允许跨域。连不上会自动回退为普通电脑。
              </div>
            </>
          )}
        </div>

        <div className="lobby-section">
          <div style={{ color: '#b9ac8f', marginBottom: 4 }}>联机模式 · 与好友同桌对战</div>
          <div className="lobby-row">
            <input
              className="input"
              placeholder="你的昵称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="lobby-row">
            <button className="btn" onClick={createRoom}>
              创建房间
            </button>
            <input
              className="input"
              placeholder="房间号"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button className="btn" onClick={joinRoom}>
              加入房间
            </button>
            <button className="btn" onClick={spectateRoom}>
              观战
            </button>
          </div>
          <div style={{ color: '#7a8f80', fontSize: 12, marginTop: 10 }}>
            需先启动服务器：项目根目录运行 pnpm dev:server（局域网好友访问
            http://你的IP:5173）
          </div>
        </div>
      </div>
    </div>
  );
}
