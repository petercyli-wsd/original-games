import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MIN_CHANCE_INV,
  RTP,
  SIZES,
  START,
  allGates,
  choose,
  crossing,
  downRightChance,
  headline,
  inGate,
  mirror,
  placeGate,
  positions,
  prizeFor,
  rowOf,
  rowRange,
  sealed,
  step,
  tally,
  validGate,
  waysOut,
  winChance,
  type Gate,
  type Pos,
} from './math';

const rng = createRng(seededSource(11));

/** Every monotone path from `from` to E, as the list of tiles it visits after `from`. */
function enumerate(n: number, from: Pos): Pos[][] {
  const out: Pos[][] = [];
  const walk = (p: Pos, acc: Pos[]) => {
    if (p.a === n && p.b === n) return void out.push(acc);
    if (p.a < n) walk({ a: p.a + 1, b: p.b }, [...acc, { a: p.a + 1, b: p.b }]);
    if (p.b < n) walk({ a: p.a, b: p.b + 1 }, [...acc, { a: p.a, b: p.b + 1 }]);
  };
  walk(from, []);
  return out;
}

/** A random state the game can reach: a random valid gate and a walker still short of it, round unsealed. */
function reachable(n: number): { gate: Gate; pos: Pos } {
  const gates = allGates(n);
  for (;;) {
    const gate = gates[rng.int(gates.length)];
    let pos = START;
    const k = rng.int(gate.row);
    for (let i = 0; i < k && sealed(n, pos, gate) === null; i++) pos = step(n, pos, rng);
    if (sealed(n, pos, gate) === null) return { gate, pos };
  }
}

describe('Pascal maths', () => {
  it('paths through a tile = ways in × ways out, and rows of Pascal counts add up', () => {
    expect(choose(16, 8)).toBe(12870);
    for (const n of SIZES) {
      for (let row = 0; row <= 2 * n; row++) {
        const sum = crossing(n, START, row).reduce((s, c) => s + c.count, 0);
        expect(sum).toBe(choose(2 * n, n));
      }
    }
  });

  it('exact enumeration: the share of all paths through the gate is the formula, from any walker position', () => {
    for (const n of SIZES) {
      const gates = allGates(n);
      // From the start: every valid gate, against all C(2n, n) paths.
      const all = enumerate(n, START);
      expect(all.length).toBe(choose(2 * n, n));
      const hits = new Map<string, number>();
      for (const p of all) for (const v of p) hits.set(`${v.a},${v.b}`, (hits.get(`${v.a},${v.b}`) ?? 0) + 1);
      for (const g of gates) {
        let through = 0;
        for (let a = g.lo; a < g.lo + g.width; a++) through += hits.get(`${a},${g.row - a}`) ?? 0;
        const t = tally(n, START, g);
        expect(t.through).toBe(through);
        expect(t.total).toBe(all.length);
      }
      // From random reachable walker positions.
      for (let trial = 0; trial < 12; trial++) {
        const { gate, pos } = reachable(n);
        const rest = enumerate(n, pos);
        const through = rest.filter((p) => p.some((v) => inGate(gate, v))).length;
        expect(tally(n, pos, gate)).toEqual({ through, total: rest.length });
      }
    }
  });

  it('closed form matches a direct simulation of the raw process (a shuffled deck of moves) and of the step rule', () => {
    const cases: { n: (typeof SIZES)[number]; gate: Gate }[] = [
      { n: 4, gate: { row: 4, lo: 1, width: 2 } },
      { n: 6, gate: { row: 3, lo: 0, width: 1 } },
      { n: 8, gate: { row: 8, lo: 4, width: 1 } },
      { n: 8, gate: { row: 11, lo: 7, width: 2 } },
      { n: 8, gate: { row: 8, lo: 2, width: 1 } },
    ];
    const rounds = 20_000;
    for (const { n, gate } of cases) {
      const p = headline(n, gate);
      const se = 4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9;
      // Raw process: shuffle n ↘ and n ↙ moves, read off where row `gate.row` is crossed.
      const deck = [...Array(n).fill(1), ...Array(n).fill(0)];
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const moves = rng.shuffle(deck);
        let a = 0;
        for (let i = 0; i < gate.row; i++) a += moves[i];
        if (a >= gate.lo && a < gate.lo + gate.width) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(se);
      // The game's step rule.
      wins = 0;
      for (let r = 0; r < rounds; r++) {
        let pos = START;
        while (rowOf(pos) < gate.row) pos = step(n, pos, rng);
        if (inGate(gate, pos)) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(se);
    }
  });

  it('the step rule makes every path equally likely: product of step chances = 1 / C(2n, n)', () => {
    for (const n of SIZES) {
      for (let trial = 0; trial < 50; trial++) {
        let pos = START;
        let prob = 1;
        while (pos.a < n || pos.b < n) {
          const q = downRightChance(n, pos);
          const next = step(n, pos, rng);
          prob *= next.a > pos.a ? q : 1 - q;
          pos = next;
        }
        expect(prob * choose(2 * n, n)).toBeCloseTo(1, 10);
      }
    }
  });

  it('martingale: at random reachable states, E[cash-out after one step] = cash-out now', () => {
    for (const n of SIZES) {
      for (let trial = 0; trial < 300; trial++) {
        const { gate, pos } = reachable(n);
        const prize = prizeFor(n, gate);
        const q = downRightChance(n, pos);
        const now = prize * winChance(n, pos, gate);
        const after = q * prize * winChance(n, { a: pos.a + 1, b: pos.b }, gate) + (1 - q) * prize * winChance(n, { a: pos.a, b: pos.b + 1 }, gate);
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
        expect(now).toBeLessThanOrEqual(prize + 1e-12);
      }
    }
  });

  it('what the board draws is the true risk: the crossing bar’s green share and the step odds', () => {
    for (const n of SIZES) {
      for (let trial = 0; trial < 200; trial++) {
        const { gate, pos } = reachable(n);
        const bar = crossing(n, pos, gate.row);
        const total = bar.reduce((s, c) => s + c.count, 0);
        const green = bar.filter((c) => inGate(gate, c.tile)).reduce((s, c) => s + c.count, 0);
        expect(total).toBe(waysOut(n, pos));
        expect(green / total).toBe(winChance(n, pos, gate));
        // The ↘ chance printed at the walker = paths through its ↘ child over all its paths.
        expect(downRightChance(n, pos)).toBeCloseTo(waysOut(n, { a: pos.a + 1, b: pos.b }) / waysOut(n, pos), 14);
        // Sealed exactly when the bar is all green or has no green.
        expect(sealed(n, pos, gate)).toBe(null);
        expect(green > 0 && green < total).toBe(true);
      }
    }
  });

  it('gates: under half the row, at least 1 in 2,000, mirror-symmetric, and the max prize is honest', () => {
    let maxPrize = 0;
    for (const n of SIZES) {
      for (let row = 1; row < 2 * n; row++) {
        const [lo, hi] = rowRange(n, row);
        // The centre tile is always a valid gate.
        expect(validGate(n, { row, lo: Math.floor((lo + hi) / 2), width: 1 })).toBe(true);
        for (let width = 1; width <= 4; width++) {
          const pos = positions(n, row, width);
          // Valid positions form one contiguous run.
          for (let i = 1; i < pos.length; i++) expect(pos[i]).toBe(pos[i - 1] + 1);
        }
      }
      for (const g of allGates(n)) {
        const p = headline(n, g);
        expect(p).toBeLessThan(1);
        expect(p * MIN_CHANCE_INV).toBeGreaterThanOrEqual(1 - 1e-12);
        expect(headline(n, mirror(n, g))).toBeCloseTo(p, 14);
        expect(validGate(n, placeGate(n, g.row, g.width, g.lo + (g.width - 1) / 2))).toBe(true);
        maxPrize = Math.max(maxPrize, prizeFor(n, g));
      }
    }
    expect(maxPrize).toBe(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 1430, 9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
