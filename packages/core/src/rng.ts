/** 种子化随机数接口（引擎纯函数需要显式注入随机源） */
export interface Rng {
  /** [0, 1) 均匀随机 */
  next(): number;
  /** [0, n) 均匀随机整数 */
  int(n: number): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n: number): number {
      return Math.floor(this.next() * n);
    },
  };
}
