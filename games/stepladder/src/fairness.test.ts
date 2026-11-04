// Fairness audit: can any way of playing Stepladder beat the RTP?
//
// The only decisions are the die you back (locked once the bet is placed; no
// switching) and, at each checkpoint, Cash out or Next roll-off. A roll-off
// draws one face of each die, uniformly and independently; the faces decide
// the new state with step(), and the cash-out is prize * P(your die wins the
// top step | state). There are only 4 dice x 6 states, so everything is exact.
//
// Martingale check, on the real step() / cashOf(): at every reachable state,
// for every die, the average cash-out over all face pairs of the next
// roll-off equals the cash-out now (1e-12), plus 40 further states met by
// random play. "Cash out" is the other action and leaves the value as it is.
//
// Strategies, per eval config (one per die), on the same functions Game.tsx uses:
//   (a) roll on only while the next roll-off is >= 80% safe, else cash out;
//   (b) cash out the moment the value exceeds the stake;
//   (c) play to the end;
//   (d) cut losses: cash out as soon as the title chance has fallen below its
//       starting value, otherwise keep rolling.
// Each is evaluated exactly by enumerating all face pairs (must equal RTP to
// 1e-9) and also by Monte Carlo with the seeded RNG (4 SE).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { surviveChance } from './eval';
import manifest from './manifest';
import { DICE, ROLL_OFFS, RTP, START, cashOf, matchOf, step, titleChance, type State } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 100_000);

/** Stop (cash out) at this checkpoint? Called after each roll-off the backer survives, before the last. */
type Stop = (die: number, s: State, cash: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) roll on while >= 80% safe', stop: (x, s) => surviveChance(x, s) < 0.8 },
  { name: '(b) take any profit', stop: (_, __, cash) => cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cut losses below the start', stop: (x, s) => titleChance(x, s) < titleChance(x, START) },
];

/** Exact expected return of a strategy, enumerating every face pair of every roll-off. */
function exactReturn(die: number, stop: Stop): number {
  const memo = new Map<number, number>();
  const go = (s: State): number => {
    const hit = memo.get(s.j);
    if (hit !== undefined) return hit;
    const { a, b } = matchOf(die, s);
    let total = 0;
    for (let fa = 1; fa <= a; fa++)
      for (let fb = 1; fb <= b; fb++) {
        const n = step(die, s, fa, fb);
        const c = cashOf(die, n);
        total += c === 0 ? 0 : n.j >= ROLL_OFFS || stop(die, n, c) ? c : go(n);
      }
    memo.set(s.j, total / (a * b));
    return total / (a * b);
  };
  return go(START);
}

/** One round as Game.tsx plays it: the bet rolls the first roll-off, then checkpoint -> stop or roll. */
function playRound(die: number, stop: Stop, rng: Rng): number {
  let s = START;
  for (;;) {
    const { a, b } = matchOf(die, s);
    s = step(die, s, 1 + rng.int(a), 1 + rng.int(b));
    const c = cashOf(die, s);
    if (c === 0 || s.j >= ROLL_OFFS || stop(die, s, c)) return c;
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
    if (x > max) max = x;
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, sum2 / rounds - mean * mean) / rounds), max };
}

/** States met by random play (alive for the backer), cycling through the dice. */
function reachedStates(count: number, rng: Rng): { die: number; s: State }[] {
  const out: { die: number; s: State }[] = [];
  while (out.length < count) {
    const die = out.length % DICE.length;
    let s = START;
    for (;;) {
      const { a, b } = matchOf(die, s);
      s = step(die, s, 1 + rng.int(a), 1 + rng.int(b));
      if (cashOf(die, s) === 0 || s.j >= ROLL_OFFS) break;
      if (rng.next() < 0.7) out.push({ die, s });
    }
  }
  return out.slice(0, count);
}

describe('Stepladder fairness', () => {
  it('martingale (exact): at every state for every die, and 40 states met by random play, a roll-off leaves the cash-out unchanged', () => {
    const rng = createRng(seededSource(2024));
    const ladder: { die: number; s: State }[] = [];
    for (let die = 0; die < DICE.length; die++) for (const s of [START, { j: 1, lost: false }, { j: 2, lost: false }]) ladder.push({ die, s });
    const states = [...ladder, ...reachedStates(40, rng)];
    expect(states.length).toBeGreaterThanOrEqual(30);
    // Not vacuous: backers both inside and outside the roll-off, with varied cash-outs.
    expect(states.filter(({ die, s }) => cashOf(die, s) > 0).length).toBeGreaterThanOrEqual(30);
    expect(new Set(states.map(({ die, s }) => cashOf(die, s).toFixed(6))).size).toBeGreaterThanOrEqual(8);
    for (const { die, s } of states) {
      const { a, b } = matchOf(die, s);
      let e = 0;
      for (let fa = 1; fa <= a; fa++) for (let fb = 1; fb <= b; fb++) e += cashOf(die, step(die, s, fa, fb)) / (a * b);
      expect(e).toBeCloseTo(cashOf(die, s), 12);
    }
    // The stake is worth RTP at the start for every die, so the choice of die changes risk, not value.
    for (let die = 0; die < DICE.length; die++) expect(cashOf(die, START)).toBeCloseTo(RTP, 12);
  });

  it('strategies (a)-(d) return RTP exactly, for every die', () => {
    for (let die = 0; die < DICE.length; die++) for (const { stop } of STRATEGIES) expect(Math.abs(exactReturn(die, stop) - RTP)).toBeLessThan(1e-9);
  });

  it('strategies (a)-(d) on every eval config return RTP within 4 SE in simulation, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { die } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(die, stop, r), ROUNDS, 4400 + 13 * ci + si);
        rows.push(`${label.padEnd(14)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(1)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});

