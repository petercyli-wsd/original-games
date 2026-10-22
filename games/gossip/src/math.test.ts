import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUDGETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  countOf,
  finishShares,
  headline,
  meanRounds,
  occupancy,
  playRound,
  prizeFor,
  reachable,
  spreadTable,
  startInformed,
  winChance,
} from './math';

const rng = createRng(seededSource(23));

describe('Gossip maths', () => {
  it('the one-call recursion matches the exact occupancy closed form', () => {
    for (const n of SIZES) {
      const t = spreadTable(n);
      for (let i = 1; i <= n; i++) {
        let sum = 0;
        for (let k = 0; k <= n - i; k++) {
          expect(Math.abs(t[i][k] - occupancy(n, i, k))).toBeLessThan(1e-12);
          sum += t[i][k];
        }
        expect(sum).toBeCloseTo(1, 12);
      }
    }
  });

  it('one caller always finds someone new; perfect doubling has the product chance', () => {
    for (const n of SIZES) expect(spreadTable(n)[1][1]).toBe(1);
    // n = 8 in 3 rounds needs 1 → 2 → 4 → 8 with no wasted call.
    const perfect = ((6 / 7) * (5 / 7)) * ((4 * 3 * 2 * 1) / 7 ** 4);
    expect(headline(8, 3)).toBeCloseTo(perfect, 12);
  });

  it('W > 0 exactly when the count can still double its way to n', () => {
    for (const n of SIZES) for (let i = 1; i <= n; i++) for (let r = 0; r <= 12; r++) expect(winChance(n, i, r) > 0).toBe(reachable(n, i, r));
  });

  it('the headline chance matches a node-level simulation of the raw process', () => {
    for (const n of SIZES) {
      const { min, max } = BUDGETS[n];
      const R = Math.round((min + max) / 2);
      const rounds = 6000;
      let wins = 0;
      for (let k = 0; k < rounds; k++) {
        let inf = startInformed(n);
        for (let t = 0; t < R && countOf(inf) < n; t++) inf = playRound(n, inf, rng).informed;
        if (countOf(inf) === n) wins++;
      }
      const p = headline(n, R);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('martingale: E[cash-out after a round] = cash-out now (closed-form transitions, every state)', () => {
    for (const n of SIZES) {
      for (let i = 1; i < n; i++) {
        for (let r = 1; r <= BUDGETS[n].max; r++) {
          let e = 0;
          for (let k = 0; k <= n - i; k++) e += occupancy(n, i, k) * winChance(n, i + k, r - 1);
          expect(Math.abs(e - winChance(n, i, r))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('martingale at random reachable states, by simulating one real round', () => {
    for (let trial = 0; trial < 12; trial++) {
      const n = SIZES[rng.int(SIZES.length)];
      const R = BUDGETS[n].max;
      let inf = startInformed(n);
      const steps = 1 + rng.int(3);
      for (let t = 0; t < steps; t++) inf = playRound(n, inf, rng).informed;
      const i = countOf(inf);
      if (i === n) continue;
      const r = R - steps;
      const before = winChance(n, i, r);
      const sims = 4000;
      let sum = 0;
      let sumSq = 0;
      for (let s = 0; s < sims; s++) {
        const w = winChance(n, countOf(playRound(n, inf, rng).informed), r - 1);
        sum += w;
        sumSq += w * w;
      }
      const mean = sum / sims;
      const se = Math.sqrt(Math.max(1e-12, sumSq / sims - mean * mean) / sims);
      expect(Math.abs(mean - before)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('the green share of the finish chart is exactly the win chance', () => {
    for (const n of SIZES) {
      for (let i = 1; i <= n; i++) {
        const H = BUDGETS[n].max + 3;
        const shares = finishShares(n, i, H);
        expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        for (let r = 0; r <= H; r++) {
          const green = shares.slice(0, r + 1).reduce((a, b) => a + b, 0);
          expect(Math.abs(green - winChance(n, i, r))).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('finish-time chart matches the simulated finishing round', () => {
    const n = 16;
    const H = 12;
    const shares = finishShares(n, 1, H);
    const counts = new Array<number>(H + 2).fill(0);
    const rounds = 8000;
    let total = 0;
    for (let k = 0; k < rounds; k++) {
      let inf = startInformed(n);
      let t = 0;
      while (countOf(inf) < n) {
        inf = playRound(n, inf, rng).informed;
        t++;
      }
      counts[Math.min(t, H + 1)]++;
      total += t;
    }
    for (let s = 1; s <= H + 1; s++) {
      const p = shares[s];
      expect(Math.abs(counts[s] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 2e-3);
    }
    // Mean spread time ≈ log₂n + ln n + O(1).
    expect(Math.abs(total / rounds - meanRounds(n))).toBeLessThan(0.08);
  });

  it('the largest prize bounds every payout', () => {
    for (const n of SIZES) for (let R = BUDGETS[n].min; R <= BUDGETS[n].max; R++) expect(prizeFor(n, R)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(prizeFor(8, 6) * winChance(8, 1, 6)).toBeCloseTo(RTP, 12);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
