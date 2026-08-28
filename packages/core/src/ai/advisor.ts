import { codeLabel, orderKey, type Card, type CardCode, type RankCode } from '../card';
import { beats, SHAPE_LABELS, type Shape } from '../shape';
import { makeCtx } from '../recognizer';
import { partnerOf } from '../types';
import { countHidden, wouldWin } from './counting';
import { handPlays } from './power';
import type { GameView } from '../engine/view';
import type { PlayOption } from '../enumerator';

/** 本地 LLM 顾问配置（Ollama 的 OpenAI 兼容接口） */
export interface AdvisorConfig {
  /** 形如 http://localhost:11434/v1 */
  baseUrl: string;
  /** 如 qwen2.5:7b */
  model: string;
  timeoutMs?: number;
  temperature?: number;
}

/** 极小的 fetch 形状：core 同时运行于浏览器/Node，不依赖 DOM/Node 类型 */
type JsonFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const defaultFetch: JsonFetch = (url, init) => (globalThis as { fetch: JsonFetch }).fetch(url, init);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('advisor: 超时')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** 调用 Ollama 的 OpenAI 兼容 /v1/chat/completions；超时/失败抛错，由调用方回退启发式 */
export class AdvisorClient {
  constructor(
    private config: AdvisorConfig,
    private fetchFn: JsonFetch = defaultFetch,
  ) {}

  async ask(prompt: string): Promise<string> {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const promise = this.fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature ?? 0,
        max_tokens: 32,
      }),
    });
    const resp = await withTimeout(promise, this.config.timeoutMs ?? 8000);
    if (!resp.ok) throw new Error(`advisor: HTTP 失败`);
    const json = (await resp.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: unknown } }[];
    };
    if (json.error) throw new Error(`advisor: ${json.error.message ?? '上游错误'}`);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) throw new Error('advisor: 空响应');
    return content;
  }
}

/** 一组牌的可读描述（按点数从大到小聚合），供提示词与候选标签共用 */
export function describeCards(cards: Card[], level: RankCode): string {
  const hist = new Map<CardCode, number>();
  for (const c of cards) {
    const code = (c >> 2) & 0x1f;
    hist.set(code, (hist.get(code) ?? 0) + 1);
  }
  const codes = [...hist.keys()].sort((a, b) => orderKey(b, level) - orderKey(a, level));
  return codes.map((c) => `${codeLabel(c)}×${hist.get(c)}`).join(' ');
}

/** 候选的紧凑标签：牌型 + 张数 + 具体牌面（跟牌时取压得过的解释，领出取最强解释） */
export function optionLabel(option: PlayOption, level: RankCode, target: Shape | null): string {
  const interp =
    target !== null
      ? option.interps.find((i) => beats(i.shape, target)) ?? option.interps[0]
      : option.interps[0];
  const shape = interp.shape;
  return `${SHAPE_LABELS[shape.k]}(${option.cards.length}张)：${describeCards(option.cards, level)}`;
}

const SEAT_NAMES = ['0号位(你)', '1号位', '2号位', '3号位'] as const;

/** 把局势 + 候选序列化成中文提示词；候选按 1..N 编号，allowPass 时 0=过牌 */
export function buildPrompt(view: GameView, options: PlayOption[], allowPass: boolean): string {
  const level = view.level;
  const mine = view.hand;
  const mate = partnerOf(view.you);
  const ctx = makeCtx(level, view.rules);
  const hidden = countHidden(mine, view.stream.flatMap((r) => r.cards));
  const playsBefore = handPlays(mine, ctx);
  const target = view.last?.shape ?? null;

  const handStr = mine.length > 0 ? describeCards(mine, level) : '（已出完）';
  const counts = view.handCounts
    .map((n, i) => `${SEAT_NAMES[i]}剩${n}张`)
    .join('，');
  const placements =
    view.placements.length > 0
      ? view.placements.map((s, i) => `${i + 1}名=${SEAT_NAMES[s]}`).join('，')
      : '无';

  let lastStr = '无（本轮由我领出）';
  if (view.last) {
    const sh = view.last.shape;
    lastStr = `${SHAPE_LABELS[sh.k]}（${view.last.cards.length}张）${describeCards(view.last.cards, level)}`;
  }

  // 每个候选附「手数变化」与「是不是还会被压」两条记牌/拆解提示，供模型决策
  const optLines = options
    .map((o, i) => {
      const interp =
        target !== null
          ? o.interps.find((x) => beats(x.shape, target)) ?? o.interps[0]
          : o.interps[0];
      const shape = interp.shape;
      const rest = mine.filter((c) => !o.cards.includes(c));
      const delta = playsBefore - handPlays(rest, ctx);
      const ww = wouldWin(shape, hidden, level);
      const hints: string[] = [];
      if (delta > 0) hints.push(`出完手数-${delta}`);
      else if (delta < 0) hints.push(`出完手数+${-delta}`);
      if (ww === true) hints.push('稳(不会被压)');
      else if (ww === false) hints.push('会被反压');
      const label = optionLabel(o, level, target);
      return `${i + 1}. ${label}${hints.length > 0 ? '〔' + hints.join(',') + '〕' : ''}`;
    })
    .join('\n');

  const range = allowPass ? `0=过牌，或 1~${options.length} 选对应候选` : `1~${options.length} 选对应候选`;

  return [
    '你是掼蛋高手。请为「0号位(你)」从下面编号的候选出牌中选出最优的一个，只回复一个整数编号，不要任何解释。',
    '',
    `【本局】打${codeLabel(level)}（红桃${codeLabel(level)}是逢人配百搭，可顶替任意牌）；队友=${SEAT_NAMES[mate]}`,
    `【各座剩余】${counts}`,
    `【已出完名次】${placements}`,
    `【我的手牌】${handStr}`,
    `【本轮需压过的牌】${lastStr}`,
    '',
    '【候选出牌】（方括号内：出完手数-X=这手让你更紧凑；稳=不会再被压；会被反压=打出去还会被别人压）',
    optLines,
    '',
    `请只回复一个整数（${range}）。`,
  ].join('\n');
}

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 把模型回复解析成候选下标（allowPass 时 0=过牌）；无法解析返回 null（触发回退） */
export function parseChoice(text: string, max: number, allowPass: boolean): number | null {
  const lo = allowPass ? 0 : 1;
  const m = text.match(/-?\d+/);
  if (m) {
    const n = Number(m[0]);
    if (Number.isInteger(n) && n >= lo && n <= max) return n;
    return null;
  }
  // 中文数字（“第三”“选三”等），取第一个命中
  for (const ch of text) {
    const v = CN_NUM[ch];
    if (v !== undefined && v >= lo && v <= max) return v;
  }
  if (allowPass && /过|不要|不出|pass/i.test(text)) return 0;
  return null;
}