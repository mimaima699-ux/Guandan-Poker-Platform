import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeCard, DEFAULT_RULES, HEART } from '@guandan/core';
import type { GameView } from '@guandan/core';
import { CardView } from './CardView';
import { SeatPanel } from './SeatPanel';
import { TrickArea } from './TrickArea';

describe('CardView', () => {
  it('渲染点数与花色，逢人配带「配」徽章', () => {
    const level = 4;
    const wild = makeCard(4, HEART, 0); // 红桃4 = 逢人配
    render(<CardView card={wild} level={level} />);
    const el = document.querySelector('.card');
    expect(el).not.toBeNull();
    expect(el!.className).toContain('wild-card');
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('渲染大王', () => {
    render(<CardView card={makeCard(16, 0, 0)} level={4} />);
    expect(screen.getByText('大王')).toBeInTheDocument();
  });
});

describe('SeatPanel', () => {
  function view(over: Partial<GameView> = {}): GameView {
    return {
      you: 0,
      phase: 'playing',
      rules: DEFAULT_RULES,
      handNo: 1,
      level: 4,
      levels: [4, 4],
      hand: [],
      handCounts: [0, 12, 8, 5],
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

  it('显示座位名、剩牌数与高亮回合', () => {
    const { container } = render(<SeatPanel view={view({ turn: 1 })} seat={1} />);
    expect(screen.getByText('右家')).toBeInTheDocument();
    expect(screen.getByText('剩 12 张')).toBeInTheDocument();
    expect(container.querySelector('.seat.turn')).not.toBeNull();
  });

  it('已出完显示名次', () => {
    render(<SeatPanel view={view({ placements: [2] })} seat={2} />);
    expect(screen.getByText('头游')).toBeInTheDocument();
  });
});

describe('TrickArea', () => {
  function view(over: Partial<GameView> = {}): GameView {
    return {
      you: 0,
      phase: 'playing',
      rules: DEFAULT_RULES,
      handNo: 1,
      level: 4,
      levels: [4, 4],
      hand: [],
      handCounts: [0, 0, 0, 0],
      turn: 0,
      leader: 0,
      last: { seat: 1, cards: [makeCard(8, 0, 0)], shape: { k: 'single', key: 5 }, wilds: [] },
      trickPlays: [],
      placements: [],
      prevPlacements: null,
      tribute: null,
      stream: [],
      winner: null,
      ...over,
    };
  }

  it('渲染过牌标记', () => {
    const v = view({
      trickPlays: [{ seat: 1, cards: [], shape: null, wilds: [], pass: true }],
    });
    render(<TrickArea view={v} />);
    expect(screen.getByText('不要')).toBeInTheDocument();
  });
});