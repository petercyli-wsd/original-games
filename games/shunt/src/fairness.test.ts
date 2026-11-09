// Fairness audit: can any way of playing Shunt beat the RTP?
//
// The only decision in a round is when to stop: after each car (the first is
// forced by Bet) the player cashes out at V = prize × P(clear | yard) or lets
// the next car in. The car count is fixed at the bet. The arriving car is a
// uniform draw from the cars still to come (Game.tsx: rest[rng.int(m)]). So:
//   1. P(clear | yard) = ∏ Catalan(block) / m! must be exact: checked against
//      brute force over every remaining arrival order through arrive();
//   2. V is a martingale: the exact average over the m equally likely next
//      cars (a jam pays 0) equals V;
//   3. every strategy is worth RTP: exactly (full enumeration of arrival
//      sequences, memoised by yard) and by Monte Carlo.
// Strategies, per eval config:
//   (a) the tester's: let the next car in while it is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the end;
//   (d) only free cars: take every car that cannot jam, cash out the moment
//       the next car could jam (the board paints those cars red);
//   (e) cash out the first time V falls (ride rises, bank the first drop).
// The game ends by itself on a jam, a clear, or once clearChance = 1 (it then
// rolls in the safe cars and pays the prize): all stopping rules.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { CARS, MAX_MULTIPLIER, RTP, arrive, cashOf, clearChance, clears, initialYard, isCleared, nextRisk, prizeOf, type Cars, type Yard } from './math';

/** Rounds per Monte Carlo run; the audit's 200k run sets FAIRNESS_ROUNDS (scratch run-heavy script). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** What the player holds after a car: 0 on a jam, else the cash-out. */
const valueAfter = (y: Yard) => (y.jammed !== null ? 0 : cashOf(y));

/** A stopping rule: true = cash out now (asked only at a checkpoint, after ≥ 1 car). */
type Stop = (y: Yard, prev: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) on while ≥ 80% safe', stop: (y) => 1 - nextRisk(y) < 0.8 },
  { name: '(b) take any profit', stop: (y) => cashOf(y) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) only free cars', stop: (y) => nextRisk(y) > 0 },
  { name: '(e) bank the first drop', stop: (y, prev) => cashOf(y) < prev },
];

const keyOf = (y: Yard) => `${y.stack.join(',')}|${y.out.length}|${y.rest.join(',')}`;

/** Exact value of a stopping rule, as Game.tsx plays it. */
function exactValue(n: Cars, stop: Stop): number {
  const memo = new Map<string, number>();
  const go = (y: Yard, steps: number, prev: number): number => {
    if (y.jammed !== null) return 0;
    if (isCleared(y)) return cashOf(y);
    if (steps >= 1) {
      if (clearChance(y) === 1) return cashOf(y); // rolls in the safe cars, pays the prize
      if (stop(y, prev)) return cashOf(y);
    }
    // (e) depends on the previous value too; it is a function of the yard path, so key on it.
    const key = `${keyOf(y)}#${steps >= 1 ? prev : -1}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = steps >= 1 ? cashOf(y) : RTP;
    let ev = 0;
    for (const car of y.rest) ev += go(arrive(y, car).yard, steps + 1, v) / y.rest.length;
    memo.set(key, ev);
    return ev;
  };
  return go(initialYard(n), 0, RTP);
}

/** One real round with the game's draw: rest[rng.int(m)]. */
function playReal(n: Cars, stop: Stop, rng: Rng): number {
  let y = initialYard(n);
  let steps = 0;
  let prev = RTP;
  for (;;) {
    const car = y.rest[rng.int(y.rest.length)];
    y = arrive(y, car).yard;
    steps++;
    if (y.jammed !== null) return 0;
    if (isCleared(y) || clearChance(y) === 1) return cashOf(y);
    if (stop(y, prev)) return cashOf(y);
    prev = cashOf(y);
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let sum2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    sum += x;
    sum2 += x * x;
    max = Math.max(max, x);
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, sum2 / rounds - mean * mean) / rounds), max };
}

/** Brute force: share of the remaining arrival orders that clear from this yard, through arrive(). */
function bruteClear(y: Yard): number {
  let good = 0;
  let all = 0;
  const walk = (z: Yard) => {
    if (z.jammed !== null) {
      // Every completion of a jammed prefix fails; count them.
      let f = 1;
      for (let i = 2; i <= z.rest.length; i++) f *= i;
      all += f;
      return;
    }
    if (z.rest.length === 0) {
      all++;
      if (isCleared(z)) good++;
      return;
    }
    for (const c of z.rest) walk(arrive(z, c).yard);
  };
  walk(y);
  return good / all;
}

/** Random reachable yards (not jammed, not cleared), from random rounds of every car count. */
function reachedYards(count: number, seed: number): Yard[] {
  const rng = createRng(seededSource(seed));
  const out: Yard[] = [];
  while (out.length < count) {
    const n = CARS[rng.int(CARS.length)];
    let y = initialYard(n);
    const stopAt = rng.int(n);
    for (let k = 0; k < stopAt; k++) {
      const z = arrive(y, y.rest[rng.int(y.rest.length)]).yard;
      if (z.jammed !== null) break;
      y = z;
    }
    if (!isCleared(y) && y.rest.length > 0) out.push(y);
  }
  return out;
}

describe('Shunt fairness', () => {
  it('Knuth: a whole order clears iff it avoids 231 (n ≤ 6, every order); start chance = Catalan/n!', () => {
    for (const n of [4, 5, 6] as Cars[]) {
      let good = 0;
      let all = 0;
      const perm = (rest: number[], acc: number[]) => {
        if (!rest.length) {
          all++;
          if (clears(acc)) good++;
          return;
        }
        for (const c of rest) perm(rest.filter((x) => x !== c), [...acc, c]);
      };
      perm(Array.from({ length: n }, (_, i) => i + 1), []);
      expect(good / all).toBe(clearChance(initialYard(n)));
      expect(cashOf(initialYard(n))).toBeCloseTo(RTP, 12);
    }
  });

  it('P(clear | yard) is exact: brute force over every remaining order at 40+ reached yards', () => {
    const yards = reachedYards(60, 3301).filter((z) => z.rest.length <= 7);
    expect(yards.length).toBeGreaterThanOrEqual(40);
    for (const y of yards) expect(clearChance(y)).toBeCloseTo(bruteClear(y), 12);
  });

  it('martingale: at 40 reached yards, letting the next car in keeps V exactly', () => {
    const yards = [...reachedYards(40, 3302), ...CARS.map((n) => initialYard(n))];
    // Near the end: yards with one or two cars left.
    for (const y of reachedYards(400, 3303)) if (y.rest.length <= 2 && yards.length < 70) yards.push(y);
    expect(yards.length).toBeGreaterThanOrEqual(30);
    expect(yards.some((y) => y.rest.length === 1)).toBe(true);
    for (const y of yards) {
      let ev = 0;
      for (const car of y.rest) ev += valueAfter(arrive(y, car).yard) / y.rest.length;
      const v = cashOf(y);
      expect(Math.abs(ev - v)).toBeLessThan(1e-12 * Math.max(1, v));
    }
  });

  it('the red share is the next-car risk: wouldJam cars / cars to come, equal to the jam rate', () => {
    for (const y of reachedYards(40, 3304)) {
      const jams = y.rest.filter((c) => arrive(y, c).yard.jammed !== null).length;
      expect(nextRisk(y)).toBe(jams / y.rest.length);
    }
  });

  it('exact: every strategy on every car count is worth RTP', () => {
    for (const n of CARS) for (const { stop } of STRATEGIES) expect(exactValue(n, stop)).toBeCloseTo(RTP, 10);
  });

  it('Monte Carlo: (a)–(e) on every eval config are within 4 SE of RTP, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((rng) => playReal(params.n, stop, rng), ROUNDS, 7100 + 37 * ci + si);
        rows.push(`${label.padEnd(16)} ${name.padEnd(26)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    expect(prizeOf(9)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
