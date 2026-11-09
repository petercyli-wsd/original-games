// Fairness audit: can any way of playing Snap beat the RTP?
//
// The break x and the number of cuts are fixed at the bet (the prize locks at
// RTP / P₀(x, k), so every break is worth RTP when chosen). In a round the only
// decision is when to stop: after each cut (the first is forced by Bet) the
// player cashes out at V = prize × P(ℓ, m) or lets the next cut fall, a
// uniform point on the stick (Game.tsx: rng.next()). The round ends by itself
// when no piece is ≥ ½ (pays the prize) or no cuts are left (pays 0). So:
//   1. winChance must be exact: checked against the inclusion–exclusion sum
//      and against a direct simulation of the raw process (polygon test on the
//      final pieces), ≥ 100k samples per state, 4 SE;
//   2. V is a martingale: E over the next cut u ~ U[0, 1] of V(after u),
//      computed by integrating the raw definition (longPiece on the new
//      pieces) piecewise between its kinks, equals V to 1e-9;
//   3. every strategy is worth RTP: Monte Carlo on every eval config with
//      random breaks on both sides (as the eval does) and at the extremes.
// Strategies, per eval config:
//   (a) the tester's: let the next cut fall while it keeps you alive with
//       chance ≥ 0.8, else cash out (only the last cut can lose outright, so
//       this is "on the last cut, go only if P ≥ 0.8");
//   (b) take any profit: cash out the moment V > 1;
//   (c) play every cut;
//   (d) read the chart: let the cut fall only if at least half the stick
//       (by length) would leave you no worse off, else cash out.
// With one cut there is no decision at all: (a), (b), (d) collapse to (c).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BREAK_MAX,
  BREAK_MIN,
  CUTS,
  HALF,
  MAX_MULTIPLIER,
  RTP,
  cutsLeft,
  heightAt,
  isPolygon,
  landscape,
  landscapeArea,
  longPiece,
  pieces,
  prizeFor,
  snapBreak,
  winChance,
  winChanceSum,
  type Cuts,
} from './math';

/** Rounds per Monte Carlo run; the audit's 200k run sets FAIRNESS_ROUNDS (scratch run-heavy script). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const chanceOf = (breaks: readonly number[], total: number) => winChance(longPiece(breaks)?.length ?? null, cutsLeft(breaks, total));

/**
 * E[f(u)] for u ~ U[0, 1], f piecewise smooth with kinks at `kinks`:
 * 16-point Gauss–Legendre on each stretch between kinks (exact for
 * polynomials up to degree 31, so for the linear pieces here).
 */
const GL_X = [
  -0.9894009349916499, -0.9445750230732326, -0.8656312023878318, -0.755404408355003, -0.6178762444026438, -0.4580167776572274, -0.2816035507792589,
  -0.0950125098376374, 0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318,
  0.9445750230732326, 0.9894009349916499,
];
const GL_W = [
  0.0271524594117541, 0.0622535239386479, 0.0951585116824928, 0.1246289712555339, 0.1495959888165767, 0.1691565193950025, 0.1826034150449236,
  0.1894506104550685, 0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928,
  0.0622535239386479, 0.0271524594117541,
];
function integrate(f: (u: number) => number, kinks: number[]): number {
  const pts = [0, 1, ...kinks.filter((k) => k > 0 && k < 1)].sort((a, b) => a - b);
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b - a <= 0) continue;
    for (let g = 0; g < GL_X.length; g++) s += ((b - a) / 2) * GL_W[g] * f((a + b) / 2 + ((b - a) / 2) * GL_X[g]);
  }
  return s;
}

/** Every place the next-cut value can kink: the cut points and ½ from each end of the long piece. */
function kinksOf(breaks: readonly number[]): number[] {
  const long = longPiece(breaks);
  const ks = [...breaks];
  if (long) ks.push(long.start + HALF, long.end - HALF);
  return ks;
}

interface State {
  breaks: number[];
  total: Cuts;
  prize: number;
}

const V = (s: State) => s.prize * chanceOf(s.breaks, s.total);

/** true = cash out now (asked only at a checkpoint: long piece present, cuts left). */
type Stop = (s: State) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  {
    name: '(a) on while ≥ 80% survive',
    // Survival of the next cut: P(V after > 0). Before the last cut nothing can lose outright.
    stop: (s) => (cutsLeft(s.breaks, s.total) === 1 ? chanceOf(s.breaks, s.total) < 0.8 : false),
  },
  { name: '(b) take any profit', stop: (s) => V(s) > 1 },
  { name: '(c) play every cut', stop: () => false },
  {
    name: '(d) go if ≥ ½ the stick no worse',
    stop: (s) => {
      // Length of the stick where the next chance is ≥ the chance now, from the board's landscape.
      const now = chanceOf(s.breaks, s.total);
      const zones = landscape(s.breaks, cutsLeft(s.breaks, s.total));
      let ok = 0;
      for (const z of zones) {
        const w = z.end - z.start;
        if (z.h0 >= now && z.h1 >= now) ok += w;
        else if (z.h0 >= now || z.h1 >= now) ok += (w * (Math.max(z.h0, z.h1) - now)) / Math.abs(z.h1 - z.h0);
      }
      return ok < 0.5;
    },
  },
];

/** One real round as Game.tsx plays it: break x (fraction), cuts from rng.next(). */
function playReal(x: number, total: Cuts, stop: Stop, rng: Rng): number {
  const s: State = { breaks: [x], total, prize: prizeFor(x, total) };
  for (;;) {
    s.breaks = [...s.breaks, rng.next()];
    const long = longPiece(s.breaks);
    const left = cutsLeft(s.breaks, total);
    if (!long) return s.prize;
    if (left === 0) return 0;
    if (stop(s)) return V(s);
  }
}

/** The eval's break choice: the config's break nudged ±2 points, either side. */
function evalBreak(brk: number, rng: Rng): number {
  const pct = snapBreak(brk + rng.int(5) - 2);
  return (rng.next() < 0.5 ? pct : 100 - pct) / 100;
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

/** Random reached states with at least one cut left and a long piece. */
function reachedStates(count: number, seed: number): State[] {
  const rng = createRng(seededSource(seed));
  const out: State[] = [];
  while (out.length < count) {
    const total = CUTS[rng.int(CUTS.length)];
    const x = snapBreak(BREAK_MIN + rng.int(BREAK_MAX - BREAK_MIN + 1)) / 100;
    const s: State = { breaks: [x], total, prize: prizeFor(x, total) };
    const fall = rng.int(total);
    for (let i = 0; i < fall && longPiece(s.breaks); i++) s.breaks = [...s.breaks, rng.next()];
    if (longPiece(s.breaks) && cutsLeft(s.breaks, total) >= 1) out.push(s);
  }
  return out;
}

describe('Snap fairness', () => {
  it('every break and cut count is worth RTP when chosen (the prize locks at RTP / P₀)', () => {
    for (const k of CUTS)
      for (let pct = BREAK_MIN; pct <= BREAK_MAX; pct++) {
        if (pct === 50) continue;
        const x = pct / 100;
        expect(prizeFor(x, k) * chanceOf([x], k)).toBeCloseTo(RTP, 12);
        expect(prizeFor(x, k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      }
    // The UI can never hold 50 (both halves long).
    for (let raw = 0; raw <= 100; raw += 0.25) expect(snapBreak(raw)).not.toBe(50);
  });

  it('winChance is exact: equals the inclusion–exclusion sum, and a direct simulation at 8 states (≥ 100k each)', () => {
    // (ℓ = ½ exactly is the tie: the sum's (x)₊⁰ convention counts it short, the game long; it has chance 0.)
    for (let l = 0.5 + 1e-9; l < 1; l += 0.0137) for (let m = 1; m <= 4; m++) expect(winChance(l, m)).toBeCloseTo(winChanceSum(l, m), 12);
    const rng = createRng(seededSource(6601));
    for (const s of reachedStates(8, 6602)) {
      const n = 100_000;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        let b = s.breaks;
        for (let c = cutsLeft(s.breaks, s.total); c > 0; c--) b = [...b, rng.next()];
        // Raw definition: every piece shorter than ½.
        const raw = pieces(b).every((p) => p.length < HALF);
        if (raw) wins++;
        if (raw !== isPolygon(b)) throw new Error(`isPolygon disagrees with the raw test at ${b.join(', ')}`);
      }
      const p = chanceOf(s.breaks, s.total);
      const se = Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('martingale: at 40 reached states, E[V after the next cut] = V (integrated from the raw definition)', () => {
    const states = reachedStates(40, 6603);
    expect(states.some((s) => cutsLeft(s.breaks, s.total) === 1)).toBe(true);
    for (const s of states) {
      const v = V(s);
      const ev = integrate((u) => {
        const b = [...s.breaks, u];
        if (!longPiece(b)) return s.prize; // polygon at once
        if (cutsLeft(b, s.total) === 0) return 0;
        return s.prize * chanceOf(b, s.total);
      }, kinksOf(s.breaks));
      expect(Math.abs(ev - v)).toBeLessThan(1e-9 * Math.max(1, v));
      // The chart on the board is the same function, and its area is the chance now.
      const m = cutsLeft(s.breaks, s.total);
      const zones = landscape(s.breaks, m);
      expect(landscapeArea(zones)).toBeCloseTo(chanceOf(s.breaks, s.total), 12);
      for (let u = 0.003; u < 1; u += 0.0491) {
        const b = [...s.breaks, u];
        const raw = !longPiece(b) ? 1 : cutsLeft(b, s.total) === 0 ? 0 : chanceOf(b, s.total);
        expect(heightAt(zones, u)).toBeCloseTo(raw, 9);
      }
    }
  });

  it('Monte Carlo: (a)–(d) on every eval config (breaks either side, as the eval picks them) are within 4 SE of RTP', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((rng) => playReal(evalBreak(params.brk, rng), params.cuts, stop, rng), ROUNDS, 9100 + 37 * ci + si);
        rows.push(`${label.split(' ')[0].padEnd(8)} ${name.padEnd(32)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('Monte Carlo at the extremes: the highest-variance break (1%) and the safest (49%), every cut count, (c) and (b)', () => {
    const rows: string[] = [];
    for (const pct of [1, 49])
      for (const k of CUTS)
        for (const { name, stop } of [STRATEGIES[1], STRATEGIES[2]]) {
          const { mean, se } = mc((rng) => playReal(pct / 100, k, stop, rng), Math.round(ROUNDS / 4), 9900 + pct * 10 + k);
          rows.push(`break ${pct}% ${k} cuts ${name.padEnd(28)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
          expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
