import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_CHANCE,
  MAX_MULTIPLIER,
  MAX_TARGET,
  MIN_CHANCE,
  MIN_TARGET,
  N,
  PRESETS,
  RTP,
  clampTarget,
  decide,
  drawK,
  exactChance,
  exactRtp,
  play,
  targetCents,
  targetForChance,
  trackPos,
  winChance,
} from './math';

const SWEEP = [MIN_TARGET, 1.02, 1.33, 1.5, 1.99, 2, 2.01, 3.7, 7.77, 10, 49.99, 123.45, 1000, 9999.99, 54321.09, 999_999.99, MAX_TARGET, ...PRESETS];

describe('Limbo maths', () => {
  it('closed form: every target is worth 0.99 / t · t = 99%', () => {
    for (const t of SWEEP) expect(winChance(t) * t).toBeCloseTo(RTP, 14);
  });

  it('exact lattice RTP is 99% to within T/(100N) and never above it', () => {
    for (const t of SWEEP) {
      const r = exactRtp(t);
      expect(r).toBeLessThanOrEqual(RTP + 1e-15);
      expect(RTP - r).toBeLessThan(targetCents(t) / 100 / N + 1e-15);
      expect(RTP - r).toBeLessThan(2.3e-10);
    }
  });

  it('the implementation wins exactly for k ≤ floor(99N/T): checked at the boundary', () => {
    for (const t of SWEEP) {
      const T = BigInt(targetCents(t));
      const kMax = Number((99n * BigInt(N)) / T);
      expect(kMax / N).toBe(exactChance(t));
      expect(decide(kMax, t).win).toBe(true);
      expect(decide(kMax + 1, t).win).toBe(false);
      expect(decide(1, t).win).toBe(true);
      expect(decide(N, t).win).toBe(false);
      // Both sides of the boundary show the right result relative to the target.
      expect(decide(kMax, t).result).toBeGreaterThanOrEqual(clampTarget(t));
      expect(decide(kMax + 1, t).result).toBeLessThan(clampTarget(t));
    }
  });

  it('the result is monotone in k and the payout is the target on a win', () => {
    let prev = Infinity;
    const rng = createRng(seededSource(11));
    const ks = Array.from({ length: 2000 }, () => drawK(rng.next)).sort((a, b) => a - b);
    for (const k of ks) {
      const o = decide(k, 2);
      expect(o.result).toBeLessThanOrEqual(prev);
      expect(o.result).toBeGreaterThanOrEqual(1);
      expect(o.result).toBeLessThanOrEqual(MAX_MULTIPLIER);
      expect(o.multiplier).toBe(o.win ? 2 : 0);
      prev = o.result;
    }
  });

  it('simulation: P(X ≥ t) matches 0.99 / t within 4 SE', () => {
    const rng = createRng(seededSource(7));
    for (const t of [1.01, 1.5, 2, 10, 100]) {
      const n = 200_000;
      let wins = 0;
      for (let i = 0; i < n; i++) if (play(rng.next, t).win) wins++;
      const p = winChance(t);
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('simulation: the result law is the fair crash law P(X ≥ x) = 0.99 / x at several x', () => {
    const rng = createRng(seededSource(19));
    const n = 200_000;
    const res = Array.from({ length: n }, () => play(rng.next, 2).result);
    for (const x of [1.01, 1.25, 3, 20, 500]) {
      const p = res.filter((r) => r >= x).length / n;
      const q = RTP / x;
      expect(Math.abs(p - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n));
    }
    // About 1% of results show the 1.00× floor and lose every target.
    const floor = res.filter((r) => r === 1).length / n;
    expect(Math.abs(floor - (1 - RTP / 1.01))).toBeLessThan(4 * Math.sqrt(0.02 / n));
  });

  it('the green share of the odds track is exactly the win chance', () => {
    for (const t of SWEEP) expect(1 - trackPos(t)).toBeCloseTo(winChance(t), 12);
    expect(trackPos(1)).toBeCloseTo(0.01, 12);
  });

  it('target and chance inputs are linked and clamped', () => {
    expect(targetForChance(49.5)).toBe(2);
    expect(targetForChance(99)).toBe(MIN_TARGET);
    expect(targetForChance(1e-9)).toBe(MAX_TARGET);
    expect(clampTarget(0.5)).toBe(MIN_TARGET);
    expect(clampTarget(2.345)).toBe(2.35);
    expect(MAX_CHANCE).toBeCloseTo(98.0198, 4);
    expect(MIN_CHANCE).toBeCloseTo(0.000099, 9);
  });

  it('the max multiplier is honest: the largest target pays 1,000,000× and nothing pays more', () => {
    expect(manifest.maxMultiplier).toBe(MAX_TARGET);
    expect(decide(1, MAX_TARGET)).toEqual({ result: MAX_TARGET, win: true, multiplier: MAX_TARGET });
    expect(decide(1, 1e9).multiplier).toBe(MAX_TARGET);
  });

  it('auto-bet style play resolves once per round (one bet, one outcome, two RNG draws)', () => {
    let calls = 0;
    const src = seededSource(5);
    const counted = () => {
      calls++;
      return src();
    };
    for (let i = 0; i < 100; i++) play(counted, 3);
    expect(calls).toBe(200);
  });

  it('simulated RTP matches the manifest in every band', () => {
    const reports = runEval(evalSpec, { rounds: 100_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[3].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
