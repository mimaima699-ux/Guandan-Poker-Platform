import { describe, expect, it } from 'vitest';
import { makeCard, type Suit } from '@guandan/core';
import { buildLocalBrains, useGame } from './store';

const C = (code: number, suit: Suit = 0) => makeCard(code, suit, 0);

describe('zustand store', () => {
  it('toggleCard 选中/取消', () => {
    const g = useGame.getState();
    g.clearSelect();
    const card = C(8);
    g.toggleCard(card);
    expect(useGame.getState().selected).toContain(card);
    g.toggleCard(card);
    expect(useGame.getState().selected).not.toContain(card);
  });

  it('toggleSort 在 rank/count 间切换', () => {
    const g = useGame.getState();
    g.toggleSort();
    expect(useGame.getState().sortMode).toBe('count');
    g.toggleSort();
    expect(useGame.getState().sortMode).toBe('rank');
  });

  it('setLocalLlm 持久化顾问配置', () => {
    useGame.getState().setLocalLlm(true, 'http://x/v1', 'm');
    const s = useGame.getState();
    expect(s.localUseLlm).toBe(true);
    expect(s.localLlmUrl).toBe('http://x/v1');
    expect(s.localLlmModel).toBe('m');
  });

  it('buildLocalBrains：关掉 Qwen 时不带 advisor，开启时共享一个 advisor', () => {
    const off = buildLocalBrains(['hard', 'hard', 'hard'], false, 'http://x/v1', 'm');
    expect(off.every((b) => b.advisor === undefined)).toBe(true);
    const on = buildLocalBrains(['hard', 'normal', 'easy'], true, 'http://x/v1', 'm');
    expect(on[0].advisor).toBeDefined();
    expect(on[0].advisor).toBe(on[1].advisor); // 共享同一实例
    expect(on[2].level).toBe('easy');
  });
});