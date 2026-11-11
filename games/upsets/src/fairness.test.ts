// Fairness: every checkpoint strategy returns exactly RTP, by exact enumeration with the game's own functions.
import { describe, expect, it } from 'vitest';
import { KS, RTP, pUpset, pWin, prizeFor, sides, status } from './math';

type Strategy = (res: number[], k: number, prize: number) => boolean; // true = cash out

const value = (res: number[], k: number, prize: number) => prize * pWin(res, k);
const strategies: [string, Strategy][] = [
  ['tester: play on only when the next match is >= 80% safe', (res) => pUpset(res, res.length) > 0.2],
  ['take any profit', (res, k, p) => value(res, k, p) > 1],
  ['play to the end', () => false],
  ['cash out once the chance halves', (res, k) => pWin(res, k) < pWin([], k) / 2],
];

function exactRtp(k: number, strat: Strategy): number {
  const prize = prizeFor(k);
  const visit = (res: number[]): number => {
    const s = status(res, k);
    if (s === 'won') return prize;
    if (s === 'lost') return 0;
    if (res.length > 0 && strat(res, k, prize)) return value(res, k, prize);
    const i = res.length;
    const [f, u] = sides(res, i);
    const pu = pUpset(res, i);
    return pu * visit([...res, u]) + (1 - pu) * visit([...res, f]);
  };
  return visit([]);
}

describe('Upsets fairness', () => {
  for (const [name, strat] of strategies) {
    it(`${name}: RTP is exactly ${RTP}`, () => {
      for (const k of KS) expect(exactRtp(k, strat)).toBeCloseTo(RTP, 10);
    });
  }
});
