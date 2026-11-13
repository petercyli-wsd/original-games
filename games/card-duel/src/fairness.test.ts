// Fairness audit: can any way of playing Card Duel beat the RTP?
// After every duel that does not end the round you may cash out (prize x P(win))
// or start the next duel. There is no switching. The next event has two
// outcomes, so strategies are valued exactly by recursion over the real queues
// (memoised by order) and by Monte Carlo through the game's own functions.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { RTP, VOLATILITY, duel, duelShare, forecast, front, isYours, prizeFor, start, winChance, winner, type Cards } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

type Policy = (c: Cards, prize: number) => boolean; // true = cash out
const goesYourWay = (c: Cards) => {
  const f = forecast(c);
  const q = duelShare(front(c).a, front(c).b);
  return f.ifYou >= f.ifHouse ? q : 1 - q;
};
const STRATEGIES: Record<string, Policy> = {
  'a tester (duel iff >=80% your way)': (c) => goesYourWay(c) < 0.8,
  'b any profit': (c, prize) => prize * winChance(c) > 1,
  'c play to the end': () => false,
  'd1 cash at 2x': (c, prize) => prize * winChance(c) >= 2,
  'd2 bail if the bad branch halves the chance': (c) => Math.min(forecast(c).ifYou, forecast(c).ifHouse) / winChance(c) < 0.5,
  'd3 cash when the strongest card is gone': (c) => !c.y.includes(10),
};

function exact(n: number, policy: Policy) {
  const prize = prizeFor(n);
  const memo = new Map<string, number>();
  const spin = (c: Cards): number => {
    const { a, b } = front(c);
    const q = duelShare(a, b);
    let v = 0;
    for (const you of [true, false]) {
      const y = duel(c, you);
      const r = winner(y);
      v += (you ? q : 1 - q) * (r ? (r === 'you' ? prize : 0) : checkpoint(y));
    }
    return v;
  };
  const checkpoint = (c: Cards): number => {
    if (policy(c, prize)) return prize * winChance(c);
    const k = c.y.join() + '|' + c.h.join();
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = spin(c);
    memo.set(k, v);
    return v;
  };
  return spin(start(n));
}

describe('Card Duel fairness', () => {
  it('prize x chance is a martingale over the next duel at 30+ varied states', () => {
    let k = 0;
    for (const [n, seed] of [[3, 1], [3, 2], [5, 3], [5, 4], [8, 5], [8, 6]]) {
      let c = start(n);
      const rng = createRng(seededSource(seed));
      for (let i = 0; i < 12 && !winner(c); i++) {
        const f = forecast(c);
        const q = duelShare(front(c).a, front(c).b);
        expect(q * f.ifYou * prizeFor(n) + (1 - q) * f.ifHouse * prizeFor(n)).toBeCloseTo(prizeFor(n) * winChance(c), 10);
        c = duel(c, isYours(rng.next(), front(c).a, front(c).b));
        k++;
      }
    }
    expect(k).toBeGreaterThanOrEqual(30);
  });
  it('the spinner green arc equals the duel chance the code uses', () => {
    for (const [a, b] of [[2, 1], [10, 19], [6, 5]]) {
      expect(isYours(duelShare(a, b) - 1e-9, a, b)).toBe(true);
      expect(isYours(duelShare(a, b), a, b)).toBe(false);
    }
  });
  for (const [name, policy] of Object.entries(STRATEGIES))
    for (const [level, { n }] of Object.entries(VOLATILITY)) {
      it(`${name}, ${level}: exactly RTP`, () => {
        expect(exact(n, policy)).toBeCloseTo(RTP, 6);
      });
    }
  it('Monte Carlo through the game functions stays within 4 SE', () => {
    const rng = createRng(seededSource(5));
    for (const { n } of Object.values(VOLATILITY)) {
      const prize = prizeFor(n);
      for (const policy of Object.values(STRATEGIES)) {
        let tot = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          let c = start(n);
          let m = 0;
          for (;;) {
            c = duel(c, isYours(rng.next(), front(c).a, front(c).b));
            const w = winner(c);
            if (w) {
              m = w === 'you' ? prize : 0;
              break;
            }
            if (policy(c, prize)) {
              m = prize * winChance(c);
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
