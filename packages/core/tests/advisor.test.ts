import { describe, expect, it } from 'vitest';
import { makeCard, type Card, type Suit } from '../src/card';
import { DEFAULT_RULES } from '../src/rules';
import { mulberry32 } from '../src/rng';
import { makeCtx } from '../src/recognizer';
import { leadOptions } from '../src/enumerator';
import type { GameView } from '../src/engine/view';
import { botAction, botActionWithBrain, type BotLevel } from '../src/ai/bot';
import { AdvisorClient, buildPrompt, describeCards, parseChoice } from '../src/ai/advisor';

const LEVEL = 4; // 红桃4 为逢人配，本测试手牌不含红桃4
const C = (code: number, suit: Suit = 0): Card => makeCard(code, suit, 0);

/** 构造一个最小但完整的 GameView（0 号位视角） */
function mkView(over: Partial<GameView> = {}): GameView {
  return {
    you: 0,
    phase: 'playing',
    rules: DEFAULT_RULES,
    handNo: 1,
    level: LEVEL,
    levels: [LEVEL, LEVEL],
    hand: [],
    handCounts: [0, 24, 24, 24],
    turn: 0,
    leader: 0,
    last: null,
    trickPlays: [],
    placements: [],
    prevPlacements: null,
    tribute: null,
    stream: [],
    winner: null,
    ...over,
  };
}

describe('AI 顾问（LLM 选牌）', () => {
  it('parseChoice：数字 / 中文 / 过牌 / 越界', () => {
    expect(parseChoice('3', 10, true)).toBe(3);
    expect(parseChoice('我选 5', 10, true)).toBe(5);
    expect(parseChoice('第三', 10, true)).toBe(3);
    expect(parseChoice('过', 5, true)).toBe(0);
    expect(parseChoice('不要', 5, true)).toBe(0);
    expect(parseChoice('99', 10, true)).toBeNull(); // 越界
    expect(parseChoice('0', 5, false)).toBeNull(); // 领出不允许过
    expect(parseChoice('乱码', 5, true)).toBeNull();
  });

  it('AdvisorClient.ask：正确解析 OpenAI 兼容响应', async () => {
    const client = new AdvisorClient(
      { baseUrl: 'http://x/v1', model: 'qwen2.5:7b', timeoutMs: 1000 },
      async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '7' } }] }),
      }),
    );
    expect(await client.ask('随便')).toBe('7');
  });

  it('AdvisorClient.ask：非 2xx 抛错', async () => {
    const client = new AdvisorClient(
      { baseUrl: 'http://x/v1', model: 'qwen2.5:7b' },
      async () => ({ ok: false, json: async () => ({}) }),
    );
    await expect(client.ask('x')).rejects.toThrow();
  });

  it('buildPrompt 包含级牌、候选编号与过牌提示', () => {
    const hand = [C(3, 0), C(3, 1), C(8, 2), C(8, 3)];
    const view = mkView({ hand, handCounts: [4, 20, 20, 20] });
    const ctx = makeCtx(view.level, view.rules);
    const options = leadOptions(hand, ctx);
    const prompt = buildPrompt(view, options, true);
    expect(prompt).toContain('打4');
    expect(prompt).toContain('逢人配');
    expect(prompt).toContain('1.');
    expect(prompt).toContain('0=过牌');
  });

  it('describeCards 按点数聚合、从大到小', () => {
    const s = describeCards([C(3, 0), C(3, 1), C(9, 0)], LEVEL);
    expect(s).toBe('9×1 3×2');
  });

  it('领出：顾问返回 1 → 打出第一个候选', async () => {
    const hand = [C(3, 0), C(3, 1), C(8, 2), C(8, 3)];
    const view = mkView({ hand, handCounts: [4, 20, 20, 20] });
    const ctx = makeCtx(view.level, view.rules);
    const first = leadOptions(hand, ctx)[0];
    const brain = {
      level: 'hard' as BotLevel,
      advisor: new AdvisorClient(
        { baseUrl: 'http://x/v1', model: 'q' },
        async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '1' } }] }) }),
      ),
    };
    const action = await botActionWithBrain(view, brain, mulberry32(1));
    expect(action.t).toBe('play');
    expect(action.t === 'play' && action.cards).toEqual(first.cards);
  });

  it('跟牌：顾问返回 0 → 过牌', async () => {
    const hand = [C(3, 0), C(3, 1), C(8, 2), C(8, 3)];
    const view = mkView({
      hand,
      handCounts: [4, 20, 20, 20],
      last: { seat: 1, cards: [C(5, 0)], shape: { k: 'single', key: 2 }, wilds: [] },
    });
    const brain = {
      level: 'hard' as BotLevel,
      advisor: new AdvisorClient(
        { baseUrl: 'http://x/v1', model: 'q' },
        async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '0' } }] }) }),
      ),
    };
    const action = await botActionWithBrain(view, brain, mulberry32(1));
    expect(action.t).toBe('pass');
  });

  it('顾问抛错 → 回退到启发式 botAction', async () => {
    const hand = [C(3, 0), C(3, 1), C(8, 2), C(8, 3)];
    const view = mkView({ hand, handCounts: [4, 20, 20, 20] });
    const brain = {
      level: 'hard' as BotLevel,
      advisor: new AdvisorClient(
        { baseUrl: 'http://x/v1', model: 'q' },
        async () => {
          throw new Error('网络断了');
        },
      ),
    };
    // 回退结果应与启发式一致：两者用同种子 rng，且出牌前 advisor 不消耗随机源
    const action = await botActionWithBrain(view, brain, mulberry32(99));
    const ref = botAction(view, 'hard', mulberry32(99));
    expect(action.t).toBe(ref.t);
    if (action.t === 'play' && ref.t === 'play') expect(action.cards).toEqual(ref.cards);
  });
});