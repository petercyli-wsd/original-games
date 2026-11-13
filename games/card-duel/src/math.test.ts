import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { SIZES, autoRound, duel, duelShare, forecast, front, houseRow, isYours, prizeFor, start, sum, winChance, winner, type Cards } from './math';

const rng = createRng(seededSource(11));

function raw(n: number, u: () => number) {
  let c = start(n);
  for (;;) {
    const { a, b } = front(c);
    c = duel(c, u() < a / (a + b));
    const w = winner(c);
    if (w) return w === 'you';
  }
}

const shuffle = <T,>(a: T[]) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

/** Every reachable card set (subsets of both rows), with random orders. */
function* states(n: number): Generator<Cards> {
  for (let ym = 1; ym < 32; ym++)
    for (let hm = 1; hm < 1 << n; hm++) {
      yield {
        y: shuffle([0, 1, 2, 3, 4].filter((i) => ym & (1 << i)).map((i) => 2 * (i + 1))),
        h: shuffle(Array.from({ length: n }, (_, j) => j).filter((j) => hm & (1 << j)).map((j) => 2 * j + 1)),
      };
    }
}

describe('Card Duel maths', () => {
  it('matches the card: P(win) at n = 3 / 5 / 6 / 8 / 10', () => {
    const want: Record<number, number> = { 3: 0.9399, 5: 0.6034, 6: 0.3912, 8: 0.1099, 10: 0.0195 };
    for (const [n, w] of Object.entries(want)) expect(winChance(start(Number(n)))).toBeCloseTo(w, 3);
  });
  it('matches a direct simulation of the raw queues (4 SE)', () => {
    for (const n of [3, 5, 8]) {
      const trials = 60_000;
      let wins = 0;
      for (let i = 0; i < trials; i++) if (raw(n, () => rng.next())) wins++;
      const w = winChance(start(n));
      expect(Math.abs(wins / trials - w)).toBeLessThan((4 * Math.sqrt(w * (1 - w))) / Math.sqrt(trials));
    }
  });
  it('does not depend on the order of the rows', () => {
    // Direct recursion over the actual queues, with the real duel and order.
    const memo = new Map<string, number>();
    const rec = (c: Cards): number => {
      const w = winner(c);
      if (w) return w === 'you' ? 1 : 0;
      const k = c.y.join() + '|' + c.h.join();
      const hit = memo.get(k);
      if (hit !== undefined) return hit;
      const { a, b } = front(c);
      const q = duelShare(a, b);
      const v = q * rec(duel(c, true)) + (1 - q) * rec(duel(c, false));
      memo.set(k, v);
      return v;
    };
    for (let t = 0; t < 40; t++) for (const n of [3, 4]) {
      const c: Cards = { y: shuffle([2, 4, 6, 8, 10]), h: shuffle(houseRow(n)) };
      expect(rec(c)).toBeCloseTo(winChance(c), 10);
    }
  });
  it('is a martingale over the next duel, at every card set and order', () => {
    for (const c of states(4)) {
      const f = forecast(c);
      const q = duelShare(front(c).a, front(c).b);
      expect(q * f.ifYou + (1 - q) * f.ifHouse).toBeCloseTo(winChance(c), 12);
    }
  });
  it('a win always raises the chance, a loss always lowers it', () => {
    for (const c of states(5)) {
      const f = forecast(c);
      expect(f.ifYou).toBeGreaterThan(winChance(c));
      expect(f.ifHouse).toBeLessThan(winChance(c));
    }
  });
  it('the card-sum bar moves the same way as the chance on every duel', () => {
    const share = (c: Cards) => sum(c.y) / (sum(c.y) + sum(c.h));
    for (const c of states(5)) {
      const w = duel(c, true);
      const l = duel(c, false);
      expect(share(w)).toBeGreaterThan(share(c));
      expect(share(l)).toBeLessThan(share(c));
    }
  });
  it('the spinner green share is exactly the duel chance', () => {
    const t = 200_000;
    let g = 0;
    for (let i = 0; i < t; i++) if (isYours(rng.next(), 8, 5)) g++;
    expect(Math.abs(g / t - 8 / 13)).toBeLessThan(0.005);
  });
  it('Auto and eval stay at RTP', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 3 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
    let tot = 0;
    const t = 80_000;
    for (let i = 0; i < t; i++) tot += autoRound(5, 2, () => rng.next()).multiplier;
    expect(Math.abs(tot / t - 0.99)).toBeLessThan(0.04);
    expect(SIZES.map(prizeFor).every((p) => p > 1)).toBe(true);
  });
});
