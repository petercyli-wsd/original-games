// Fairness audit: can any way of playing Break Point beat the RTP?
// After every point that doesn't end the game you may cash out (prize x P(win))
// or spin the next point. There is no switching. The next event has two
// outcomes, so strategies are valued exactly by recursion (deep deuce loops are
// cut by a cash-out, itself a stopping rule) and by Monte Carlo through the
// game's own functions.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { EMPTY, RTP, SHARES, VOLATILITY, addPoint, forecast, isYours, prizeFor, winChance, winner, type Score } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const MAX_POINTS = 40;

type Policy = (x: Score, p: number, prize: number) => boolean; // true = cash out
const goesYourWay = (x: Score, p: number) => {
  const f = forecast(x, p);
  return f.ifYou >= f.ifServer ? 1 - p : p;
};
const STRATEGIES: Record<string, Policy> = {
  'a tester (spin iff >=80% your way)': (x, p) => goesYourWay(x, p) < 0.8,
  'b any profit': (x, p, prize) => prize * winChance(x, p) > 1,
  'c play to the end': () => false,
  'd1 cash at 2x': (x, p, prize) => prize * winChance(x, p) >= 2,
  'd2 bail if the bad branch halves the chance': (x, p) => Math.min(forecast(x, p).ifYou, forecast(x, p).ifServer) / winChance(x, p) < 0.5,
  'd3 cash before a decider': (x, p) => [forecast(x, p).ifYou, forecast(x, p).ifServer].some((v) => v <= 1e-12 || v >= 1 - 1e-12),
};

function exact(p: number, policy: Policy) {
  const prize = prizeFor(p);
  const memo = new Map<string, number>();
  const spin = (x: Score): number => {
    let v = 0;
    for (const you of [true, false]) {
      const w = you ? 1 - p : p;
      const y = addPoint(x, you);
      const r = winner(y);
      v += w * (r ? (r === 'you' ? prize : 0) : checkpoint(y));
    }
    return v;
  };
  const checkpoint = (x: Score): number => {
    if (x.r + x.s >= MAX_POINTS || policy(x, p, prize)) return prize * winChance(x, p);
    const k = `${x.r},${x.s}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = spin(x);
    memo.set(k, v);
    return v;
  };
  return spin(EMPTY);
}

describe('Break Point fairness', () => {
  it('prize x chance is a martingale over the next point at 30+ varied states', () => {
    let n = 0;
    for (const p of SHARES)
      for (const [r, s] of [[0, 0], [1, 0], [0, 1], [2, 1], [1, 3], [3, 3], [4, 3], [3, 4], [5, 5], [2, 2]]) {
        const x: Score = { r, s };
        const f = forecast(x, p);
        expect((1 - p) * f.ifYou * prizeFor(p) + p * f.ifServer * prizeFor(p)).toBeCloseTo(prizeFor(p) * winChance(x, p), 10);
        n++;
      }
    expect(n).toBeGreaterThanOrEqual(30);
  });
  it('the spinner green arc equals the point chance the code uses', () => {
    for (const p of SHARES) {
      expect(isYours(1 - p - 1e-9, p)).toBe(true);
      expect(isYours(1 - p, p)).toBe(false);
    }
  });
  for (const [name, policy] of Object.entries(STRATEGIES))
    for (const [level, { p }] of Object.entries(VOLATILITY)) {
      it(`${name}, ${level}: exactly RTP`, () => {
        expect(exact(p, policy)).toBeCloseTo(RTP, 6);
      });
    }
  it('Monte Carlo through the game functions stays within 4 SE', () => {
    const rng = createRng(seededSource(5));
    for (const { p } of Object.values(VOLATILITY)) {
      const prize = prizeFor(p);
      for (const policy of Object.values(STRATEGIES)) {
        let tot = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          let x = EMPTY;
          let m = 0;
          for (;;) {
            x = addPoint(x, isYours(rng.next(), p));
            const w = winner(x);
            if (w) {
              m = w === 'you' ? prize : 0;
              break;
            }
            if (policy(x, p, prize)) {
              m = prize * winChance(x, p);
              break;
            }
          }
          tot += m;
          sq += m * m;
        }
        const mean = tot / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
