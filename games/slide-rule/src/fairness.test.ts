// Fairness audit: can any way of playing Slide Rule beat the RTP?
//
// The digits and the number of factors are fixed at the bet, so the only
// decision is when to stop: after each factor (the first is forced by Bet) the
// player cashes out at V = prize × P(win | product, factors left) or spins the
// next factor, a uniform pick from {2…9} (Game.tsx: FACTORS[rng.int(8)]).
// The round ends by itself at P = 0 (pays 0) or P = 1 (pays the prize). So:
//   1. winChance must be exact: checked against brute force over every
//      remaining factor sequence, reading the leading digit from the decimal
//      string of the integer product;
//   2. V is a martingale: the exact average over the 8 next factors equals V;
//   3. every strategy is worth RTP: exactly (enumeration memoised on the
//      product) on every eval config and on random settings, and by Monte Carlo.
// Strategies, per eval config:
//   (a) the tester's: spin while ≥ 80% of the 8 landing dots keep a chance
//       to win (at the last factor: P(win) ≥ 0.8), else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play every factor;
//   (d) read the dots: spin only when at least 5 of the 8 landing dots raise
//       your chance, else cash out (the board draws each dot's chance).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  FACTORS,
  LENGTHS,
  MAX_MULTIPLIER,
  RTP,
  blockReason,
  nextLandings,
  prizeFor,
  startChance,
  winChance,
  type DigitSet,
  type Length,
} from './math';

/** Rounds per Monte Carlo run; the audit's 200k run sets FAIRNESS_ROUNDS (scratch run-heavy script). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** What the player holds after a factor, as Game.tsx's draw() computes it. */
const valueAt = (prize: number, c: number, left: number, s: DigitSet) => {
  const p = winChance(c, left, s);
  return p >= 1 ? prize : prize * p;
};

/** true = cash out now (asked only at a checkpoint: 0 < P < 1, factors left). */
type Stop = (c: number, left: number, s: DigitSet, prize: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  {
    name: '(a) on while ≥ 80% dots alive',
    stop: (c, left, s) => nextLandings(c, left, s).filter((l) => l.chance > 0).length / FACTORS.length < 0.8,
  },
  { name: '(b) take any profit', stop: (c, left, s, prize) => prize * winChance(c, left, s) > 1 },
  { name: '(c) play every factor', stop: () => false },
  {
    name: '(d) spin if ≥ 5 dots rise',
    stop: (c, left, s) => {
      const now = winChance(c, left, s);
      return nextLandings(c, left, s).filter((l) => l.chance > now).length < 5;
    },
  },
];

/** Exact value of a stopping rule (every factor sequence, memoised on the product). */
function exactValue(s: DigitSet, k: Length, stop: Stop): number {
  const prize = prizeFor(s, k);
  // The value depends only on (product, factors left): memoise on that.
  const memo = new Map<number, number>();
  const go = (c: number, left: number, first: boolean): number => {
    const key = c * 16 + left;
    const hit = first ? undefined : memo.get(key);
    if (hit !== undefined) return hit;
    const v = value(c, left, first);
    if (!first) memo.set(key, v);
    return v;
  };
  const value = (c: number, left: number, first: boolean): number => {
    if (!first) {
      const p = winChance(c, left, s);
      if (left === 0) return p >= 1 ? prize : 0;
      if (p <= 0) return 0;
      if (p >= 1) return prize;
      if (stop(c, left, s, prize)) return prize * p;
    }
    let ev = 0;
    for (const f of FACTORS) ev += go(c * f, left - 1, false) / FACTORS.length;
    return ev;
  };
  return go(1, k, true);
}

/** One real round with the game's draw. */
function playReal(s: DigitSet, k: Length, stop: Stop, rng: Rng): number {
  const prize = prizeFor(s, k);
  let c = 1;
  let left: number = k;
  for (;;) {
    c *= FACTORS[rng.int(FACTORS.length)];
    left--;
    const p = winChance(c, left, s);
    // The final result is read from the integer, independently of the table.
    if (left === 0) return digitOf(c) & s ? prize : 0;
    if (p <= 0) return 0;
    if (p >= 1) return prize;
    if (stop(c, left, s, prize)) return valueAt(prize, c, left, s);
  }
}

/** Bit of the leading digit, read from the decimal string. */
const digitOf = (n: number) => 1 << Number(String(n)[0]);

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

/** Brute force: share of the 8^j remaining sequences ending on a backed digit. */
function bruteChance(c: number, j: number, s: DigitSet): number {
  let win = 0;
  let all = 0;
  const walk = (x: number, left: number) => {
    if (left === 0) {
      all++;
      if (digitOf(x) & s) win++;
      return;
    }
    for (const f of FACTORS) walk(x * f, left - 1);
  };
  walk(c, j);
  return win / all;
}

/** Random playable settings: a digit set and a length that blockReason accepts. */
function randomSettings(rng: Rng): { s: DigitSet; k: Length } {
  for (;;) {
    const s = (1 + rng.int(511)) << 1; // bits 1..9
    const k = LENGTHS[rng.int(LENGTHS.length)];
    if (!blockReason(s, k)) return { s, k };
  }
}

describe('Slide Rule fairness', () => {
  it('winChance is exact: brute force over every remaining sequence at 40 reached states', () => {
    const rng = createRng(seededSource(5501));
    let checked = 0;
    while (checked < 40) {
      const { s, k } = randomSettings(rng);
      let c = 1;
      const depth = rng.int(k + 1);
      for (let i = 0; i < depth; i++) c *= FACTORS[rng.int(FACTORS.length)];
      const j = k - depth;
      if (j > 5) continue; // 8^5 sequences at most per check
      expect(winChance(c, j, s)).toBe(bruteChance(c, j, s));
      checked++;
    }
    // And every start with up to 5 factors, every single digit.
    for (const k of [1, 2, 3, 4, 5] as Length[]) for (let d = 1; d <= 9; d++) expect(startChance(1 << d, k)).toBe(bruteChance(1, k, 1 << d));
  });

  it('martingale: at 40+ reached states, the next factor keeps V exactly (including auto-stops at P = 0 and 1)', () => {
    const rng = createRng(seededSource(5502));
    let states = 0;
    let nearEnd = 0;
    while (states < 60) {
      const { s, k } = randomSettings(rng);
      const prize = prizeFor(s, k);
      let c = 1;
      const depth = rng.int(k);
      let alive = true;
      for (let i = 0; i < depth && alive; i++) {
        c *= FACTORS[rng.int(FACTORS.length)];
        const p = winChance(c, k - i - 1, s);
        alive = p > 0 && p < 1;
      }
      if (!alive) continue;
      const left = k - depth;
      const v = prize * winChance(c, left, s);
      let ev = 0;
      for (const f of FACTORS) ev += valueAt(prize, c * f, left - 1, s) / FACTORS.length;
      expect(Math.abs(ev - v)).toBeLessThan(1e-12 * Math.max(1, v));
      // The 8 dots drawn on the board average to the chance now.
      const dots = nextLandings(c, left, s);
      expect(dots.reduce((a, l) => a + l.chance, 0) / dots.length).toBeCloseTo(winChance(c, left, s), 14);
      states++;
      if (left === 1) nearEnd++;
    }
    expect(nearEnd).toBeGreaterThan(0);
  });

  it('exact: every strategy is worth RTP on every eval config and on 30 random settings', () => {
    const rng = createRng(seededSource(5503));
    const settings = [
      ...evalSpec.configs.map((c) => ({ s: c.params.digits, k: c.params.factors })),
      ...Array.from({ length: 30 }, () => randomSettings(rng)),
    ];
    for (const { s, k } of settings) for (const { stop } of STRATEGIES) expect(exactValue(s, k, stop)).toBeCloseTo(RTP, 10);
  });

  it('Monte Carlo: (a)–(d) on every eval config are within 4 SE of RTP, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((rng) => playReal(params.digits, params.factors, stop, rng), ROUNDS, 8100 + 37 * ci + si);
        rows.push(`${label.split(' ')[0].padEnd(8)} ${name.padEnd(30)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
