import { describe, expect, it } from 'vitest';
import { seatBrains } from './local';

describe('LocalDriver 座位↔大脑映射', () => {
  it('3 个机器人映射到座位 1/2/3，座位 0 是人类占位', () => {
    const easy = { level: 'easy' as const };
    const normal = { level: 'normal' as const };
    const expert = { level: 'expert' as const };
    const seats = seatBrains([easy, normal, expert]);
    expect(seats).toHaveLength(4);
    expect(seats[0].level).toBe('normal'); // 占位
    expect(seats[1]).toBe(easy); // 座位 1
    expect(seats[2]).toBe(normal); // 座位 2
    expect(seats[3]).toBe(expert); // 座位 3 —— 之前这里是 undefined 导致左家死机
  });

  it('不足 3 个时补普通档，不会出现 undefined', () => {
    const seats = seatBrains([{ level: 'hard' as const }]);
    expect(seats[3]).toBeDefined();
    expect(seats[3].level).toBe('normal');
  });
});