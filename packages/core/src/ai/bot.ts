import {
  codeOf,
  isJokerCode,
  isWildCard,
  orderKey,
  type Card,
} from '../card';
import { beats, keyOf, sizeOfShape, tierOf, type Shape } from '../shape';
import { interpret, makeCtx, type PlayCtx } from '../recognizer';
import { beatOptions, leadOptions, type PlayOption } from '../enumerator';
import { AdvisorClient, buildPrompt, parseChoice } from './advisor';
import { countHidden, wouldWin, type HiddenInfo } from './counting';
import { handPlays } from './power';
import { rolloutBest, type RolloutMove } from './rollout';
import { handInfo } from '../hand';
import { partnerOf, teamOf, type SeatId } from '../types';
import type { Rng } from '../rng';
import type { GameView } from '../engine/view';
import type { Action } from '../engine/engine';

/**
 * 规则型机器人。无状态设计：所有决策从 GameView 现场推导（与真人可见信息一致），
 * 因此单机 / 联机托管 / 断线重连三种场景行为完全一致。
 *
 * 四档难度：
 *  easy   合法出法随机（偏小）
 *  normal 启发式打分 + 基础队友配合
 *  hard   normal + 更保守的百搭/火力估值 + 局面压力感知
 *  expert hard  + 记牌（炸弹是否还能被压 / 王与级牌去向）驱动的火力与节奏判断
 */
export type BotLevel = 'easy' | 'normal' | 'hard' | 'expert';

/** 机器人大脑：level 为启发式兜底难度；advisor 存在时出牌阶段交给 LLM 选牌 */
export interface BotBrain {
  level: BotLevel;
  advisor?: AdvisorClient;
}

export function botAction(view: GameView, bot: BotLevel, rng: Rng): Action {
  const you = view.you;
  switch (view.phase) {
    case 'idle':
    case 'handOver':
      return { t: 'deal' }; // 驱动层也可代发；bot 自足以支持仿真与托管
    case 'tribute':
      return { t: 'tribute', seat: you, card: pickTribute(view) };
    case 'tributeReturn':
      return { t: 'returnTribute', seat: you, card: pickReturn(view) };
    case 'playing': {
      const hidden = countHidden(view.hand, view.stream.flatMap((r) => r.cards));
      if (!view.last) return botLead(view, bot, rng, hidden);
      return botFollow(view, bot, rng, hidden);
    }
    default:
      return { t: 'pass', seat: you };
  }
}

/**
 * 带「大脑」的异步决策入口：出牌阶段若配置了 advisor，则枚举合法候选交给 LLM 选牌，
 * 任何超时/解析失败/网络错误都回退到启发式 botAction；其余阶段一律走启发式。
 */
export async function botActionWithBrain(
  view: GameView,
  brain: BotBrain,
  rng: Rng,
): Promise<Action> {
  if (view.phase !== 'playing' || !brain.advisor) {
    return botAction(view, brain.level, rng);
  }
  try {
    const ctx = makeCtx(view.level, view.rules);
    const target = view.last?.shape ?? null;
    const allowPass = target !== null;
    const options =
      target !== null ? beatOptions(view.hand, target, ctx) : leadOptions(view.hand, ctx);
    if (options.length === 0) return botAction(view, brain.level, rng);
    const text = await brain.advisor.ask(buildPrompt(view, options, allowPass));
    const idx = parseChoice(text, options.length, allowPass);
    if (idx === null) throw new Error('advisor: 无法解析出牌下标');
    if (allowPass && idx === 0) return { t: 'pass', seat: view.you };
    const option = options[idx - 1];
    if (!option) throw new Error('advisor: 出牌下标越界');
    return playAction(view.you, option, target);
  } catch {
    return botAction(view, brain.level, rng);
  }
}

/** 进贡：手中最大的非逢人配牌（引擎强制，无策略空间） */
function pickTribute(view: GameView): Card {
  const cands = view.hand.filter((c) => !isWildCard(c, view.level));
  let best = cands[0];
  for (const c of cands) {
    if (orderKey(codeOf(c), view.level) > orderKey(codeOf(best), view.level)) best = c;
  }
  return best;
}

/** 还贡：≤10 非配牌中最小且最孤立的 */
function pickReturn(view: GameView): Card {
  const cands = view.hand.filter(
    (c) => !isWildCard(c, view.level) && !isJokerCode(codeOf(c)) && codeOf(c) <= 10,
  );
  const info = handInfo(view.hand, view.level, view.rules);
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands) {
    const isolated = (info.byCode.get(codeOf(c))?.length ?? 0) === 1 ? -3 : 0; // 孤张优先送
    const s = orderKey(codeOf(c), view.level) * 2 + isolated;
    if (s < bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/** —————— 跟牌 —————— */
function botFollow(view: GameView, bot: BotLevel, rng: Rng, hidden: HiddenInfo): Action {
  const you = view.you;
  const ctx = makeCtx(view.level, view.rules);
  const target = view.last!.shape;
  const lastSeat = view.last!.seat;
  const mate = partnerOf(you);
  const opts = beatOptions(view.hand, target, ctx);
  const winning = (o: PlayOption) => o.cards.length === view.hand.length; // 出完

  // 队友当前最大：让牌（除非自己能直接出完抢名次）
  if (lastSeat === mate && view.handCounts[mate] > 0) {
    const winNow = opts.find(winning);
    if (winNow) return playAction(you, winNow, target);
    if (bot !== 'easy' || rng.next() < 0.75 || opts.length === 0) {
      return { t: 'pass', seat: you };
    }
  }
  if (opts.length === 0) return { t: 'pass', seat: you };

  if (bot === 'easy') {
    if (rng.next() < 0.25) return { t: 'pass', seat: you };
    return playAction(you, opts[rng.int(opts.length)], target);
  }

  // 对手压力：对手最少剩牌
  const myTeam = teamOf(you);
  const oppMin = Math.min(
    ...([0, 1, 2, 3] as SeatId[]).filter((s) => teamOf(s) !== myTeam).map((s) => view.handCounts[s]),
  );
  const desperate = oppMin <= 6;
  const t0 = tierOf(target);

  const playedShape = (o: PlayOption): Shape => beatShape(o, target, ctx);
  const nonBomb = opts.filter((o) => tierOf(playedShape(o)) === 0);
  let pool: PlayOption[];
  if (nonBomb.length > 0) {
    pool = nonBomb;
  } else if (t0 === 0 && !desperate) {
    // 只能靠炸压小牌、对手又不危急 → 不烧火力
    return { t: 'pass', seat: you };
  } else {
    pool = opts; // 对手用了火力或即将走完 → 允许升维压制
  }

  // expert：非危急时，若眼前已是一手炸/同花顺，而我手里所有能压过它的都
  // 是「还会再被反压」的非顶炸，宁可 pass 也不烧（烧掉也拿不回主动权）。
  if (bot === 'expert' && t0 > 0 && !desperate) {
    const anyTop = pool.some((o) => {
      const sh = playedShape(o);
      return sh.k !== 'bomb' || wouldWin(sh, hidden, view.level) === true;
    });
    if (!anyTop) return { t: 'pass', seat: you };
  }

  const scored = pool.map((o) => {
    let s = -playCost(view, o, ctx, bot);
    if (winning(o)) s += 1000;
    if (bot === 'expert' && !desperate) {
      const sh = playedShape(o);
      if (sh.k === 'bomb' && wouldWin(sh, hidden, view.level) === false) s -= 250; // 别烧会被反压的炸
    }
    s += rng.next() * 0.01; // 抖动去平局
    return { o, s };
  });
  scored.sort((a, b) => b.s - a.s);

  if (scored.length === 0) return { t: 'pass', seat: you };
  return playAction(you, scored[0].o, target);
}

/** —————— 领出 —————— */
function botLead(view: GameView, bot: BotLevel, rng: Rng, hidden: HiddenInfo): Action {
  const you = view.you;
  const ctx = makeCtx(view.level, view.rules);
  const opts = leadOptions(view.hand, ctx);
  if (opts.length === 0) return { t: 'pass', seat: you };

  const shapeOf = (o: PlayOption): Shape => o.interps[0].shape;
  const normal = opts.filter((o) => Math.min(...o.interps.map((i) => tierOf(i.shape))) === 0);
  const pool = normal.length > 0 ? normal : opts;

  if (bot === 'easy') {
    // 按 key 升序，前 60% 里随机
    const sorted = pool.slice().sort((a, b) => keyOf(shapeOf(a)) - keyOf(shapeOf(b)));
    const range = Math.max(1, Math.ceil(sorted.length * 0.6));
    return playAction(you, sorted[rng.int(range)], null);
  }

  const mate = partnerOf(you);
  const myTeam = teamOf(you);
  const oppMin = Math.min(
    ...([0, 1, 2, 3] as SeatId[]).filter((s) => teamOf(s) !== myTeam).map((s) => view.handCounts[s]),
  );
  const mateLow =
    !view.placements.includes(mate) &&
    view.handCounts[mate] > 0 &&
    view.handCounts[mate] <= 2;

  // expert：领出时用「出完还需几手」做拆解信号，优先选能让整手更紧凑的牌
  const playsBefore = bot === 'expert' ? handPlays(view.hand, ctx) : 0;

  const scored = pool.map((o) => {
    const sh = shapeOf(o);
    let s = 0;
    if (o.cards.length === view.hand.length) s += 1000; // 一手出完
    s += sizeOfShape(sh) * 4; // 长型先走（出牌效率）
    s -= keyOf(sh) * 2; // 小牌先走
    if (oppMin <= 4) {
      // 对手快走完：封锁，避免喂小单/小对
      if (sh.k === 'single' && keyOf(sh) < 8) s -= 30;
      if (sh.k === 'pair' && keyOf(sh) < 5) s -= 20;
      if (sizeOfShape(sh) >= 5) s += 10;
    }
    if (mateLow) {
      // 喂牌：队友剩 1 张出单、剩 2 张出对
      if (view.handCounts[mate] === 1 && sh.k === 'single') s += 18;
      if (view.handCounts[mate] === 2 && sh.k === 'pair') s += 18;
    }
    if (o.cards.some((c) => isWildCard(c, view.level))) s -= bot === 'normal' ? 15 : 25; // 百搭留后手
    if (keyOf(sh) >= 11) s -= 8; // 大牌首出略减（保留控制）
    if (bot === 'expert' && hidden.bigJokers + hidden.smallJokers >= 2) {
      // 王都还在外面：先扔长牌组合，尽量少开单张/对子的口子
      if (sizeOfShape(sh) >= 3) s += 6;
    }
    if (bot === 'expert') {
      const rest = view.hand.filter((c) => !o.cards.includes(c));
      s += (playsBefore - handPlays(rest, ctx)) * 5; // 每少一手强奖励
    }
    s += rng.next() * 0.01;
    return { o, s };
  });

  scored.sort((a, b) => b.s - a.s);
  let clip = scored[0].o;

  // expert 残局：对贪婪分前 K 的候选做蒙特卡洛 rollout，用「我队最终名次」精排
  if (bot === 'expert' && view.hand.length <= 12 && scored.length > 1) {
    const K = Math.min(3, scored.length);
    const moves: RolloutMove[] = scored
      .slice(0, K)
      .map(({ o }) => ({ cards: o.cards, interpId: 0, pass: false }));
    const idx = rolloutBest(view, moves, rng, { samples: 4, maxSteps: 60 });
    clip = scored[idx].o;
  }

  return playAction(you, clip, null);
}

/** —————— 工具 —————— */

/** 候选中真正压过 target 的解释 */
function beatShape(o: PlayOption, target: Shape, ctx: PlayCtx): Shape {
  const interps = o.interps.length > 0 ? o.interps : interpret(o.cards, ctx);
  return interps.find((i) => beats(i.shape, target))?.shape ?? interps[0].shape;
}

/** 组装出牌动作（选定压得过的解释；领出取最强解释） */
function playAction(seat: SeatId, o: PlayOption, target: Shape | null): Action {
  let idx = 0;
  if (target !== null) {
    idx = o.interps.findIndex((i) => beats(i.shape, target));
    if (idx < 0) idx = 0;
  }
  return { t: 'play', seat, cards: o.cards, interpId: idx };
}

/** 打出该候选的代价（越大越舍不得） */
function playCost(view: GameView, o: PlayOption, ctx: PlayCtx, bot: BotLevel): number {
  const remaining = view.hand.filter((c) => !o.cards.includes(c));
  let cost = 0;
  for (const c of o.cards) {
    const k = orderKey(codeOf(c), view.level);
    cost += k * k * 0.15; // 大牌损失（A/级牌/王显著更贵）
    if (isWildCard(c, view.level)) cost += bot === 'hard' || bot === 'expert' ? 30 : 20; // 烧百搭
  }
  const sh = o.interps[0].shape;
  cost += tierOf(sh) * 45; // 烧火力（炸/同花顺）
  cost += (scatter(remaining, ctx) - scatter(view.hand, ctx)) * 6; // 拆牌散化
  cost -= sizeOfShape(sh) * 3; // 多走牌是收益
  return cost;
}

/** 手牌散度：奇数张留下的孤张数（王恒为孤张） */
function scatter(hand: Card[], ctx: PlayCtx): number {
  const info = handInfo(hand, ctx.level, ctx.rules);
  let s = 0;
  for (const [code, list] of info.byCode) {
    if (isJokerCode(code)) s += list.length;
    else s += list.length % 2 === 1 ? 1 : 0;
  }
  return s;
}
