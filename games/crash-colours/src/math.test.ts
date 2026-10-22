import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BANDS,
  MAX_MULTIPLIER,
  MOONS,
  RTP,
  SPLITS,
  chances,
  crashFromU,
  crashPoint,
  distribution,
  expectedReturn,
  multAt,
  multiplierOf,
  payoutOf,
  payouts,
  scaleStakes,
  survival,
  timeAt,
  totalOf,
  winners,
  type Stakes,
} from './math';

const ALL_LINES = SPLITS.flatMap((split) => MOONS.filter((m) => m > split).map((moon) => ({ split, moon })));

describe('Crash Colours maths', () => {
  it('every band at every line returns exactly the RTP (closed form)', () => {
    for (const lines of ALL_LINES) {
      const p = chances(lines);
      const pay = payouts(lines);
      for (const b of BANDS) expect(p[b] * pay[b]).toBeCloseTo(RTP, 12);
      expect(p.red + p.green).toBeCloseTo(1, 14);
    }
    const classic = payouts({ split: 2, moon: 10 });
    expect(classic.red).toBeCloseTo(0.99 / 0.505, 12);
    expect(classic.red.toFixed(4)).toBe('1.9604');
    expect(classic.green).toBe(2);
    expect(classic.moon).toBe(10);
  });

  it('any stake mix returns exactly the RTP (enumeration over the three crash regions)', () => {
    const rng = createRng(seededSource(11));
    for (let i = 0; i < 500; i++) {
      const lines = ALL_LINES[rng.int(ALL_LINES.length)];
      const stakes: Stakes = { red: rng.next() < 0.3 ? 0 : rng.next(), green: rng.next() < 0.3 ? 0 : rng.next(), moon: rng.next() + 0.01 };
      const d = distribution(stakes, lines);
      expect(d.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 14);
      expect(expectedReturn(stakes, lines)).toBeCloseTo(RTP, 12);
    }
  });

  it('the crash point follows P(C ≥ t) = 0.99/t exactly at the boundaries', () => {
    for (const t of [1.01, 1.5, 2, 3, 5, 10, 20, 50, 100, 1000, 12345.67]) {
      const U = RTP / t;
      expect(crashFromU(U * (1 - 1e-12))).toBeGreaterThanOrEqual(t);
      expect(crashFromU(U * (1 + 1e-9))).toBeLessThan(t);
    }
    expect(crashFromU(1)).toBe(1);
    expect(crashFromU(0.995)).toBe(1);
    expect(crashFromU(1e-12)).toBe(1_000_000);
    expect(crashPoint(0)).toBe(1);
  });

  it('a simulation of the raw draw matches the survival law (4 SE)', () => {
    const rng = createRng(seededSource(5));
    const n = 300_000;
    const targets = [1.01, 1.5, 2, 3, 10, 100];
    const hits = targets.map(() => 0);
    for (let i = 0; i < n; i++) {
      const c = crashPoint(rng.next());
      targets.forEach((t, k) => {
        if (c >= t) hits[k]++;
      });
    }
    targets.forEach((t, k) => {
      const p = survival(t);
      expect(Math.abs(hits[k] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    });
  });

  it('simulated band payouts match the exact RTP for every line (4 SE)', () => {
    const rng = createRng(seededSource(9));
    const n = 60_000;
    for (const lines of [
      { split: 1.5, moon: 5 },
      { split: 2, moon: 10 },
      { split: 3, moon: 50 },
    ]) {
      for (const b of BANDS) {
        const stakes: Stakes = { red: 0, green: 0, moon: 0, [b]: 1 };
        let s = 0;
        let s2 = 0;
        for (let i = 0; i < n; i++) {
          const x = multiplierOf(stakes, crashPoint(rng.next()), lines);
          s += x;
          s2 += x * x;
        }
        const mean = s / n;
        const se = Math.sqrt((s2 / n - mean * mean) / n);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      }
    }
  });

  it('the paytable is monotone: Red pays less as its region grows, Green and Moon pay their line', () => {
    const reds = SPLITS.map((split) => payouts({ split, moon: 1000 }).red);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeLessThan(reds[i - 1]);
    for (const lines of ALL_LINES) {
      const pay = payouts(lines);
      expect(pay.green).toBe(lines.split);
      expect(pay.moon).toBe(lines.moon);
      expect(pay.moon).toBeGreaterThan(pay.green);
      expect(pay.red).toBeGreaterThan(1);
    }
  });

  it('ties go to the higher band: C = L is Green, C = M is Moon', () => {
    expect(winners(2, { split: 2, moon: 10 })).toEqual({ red: false, green: true, moon: false });
    expect(winners(1.99, { split: 2, moon: 10 })).toEqual({ red: true, green: false, moon: false });
    expect(winners(10, { split: 2, moon: 10 })).toEqual({ red: false, green: true, moon: true });
  });

  it('the bands lit by the climb are exactly the bands the crash point wins', () => {
    const T = 2600;
    for (const crash of [1, 1.2, 1.99, 2, 2.5, 9.99, 10, 37.4, 1000]) {
      const lines = { split: 2, moon: 10 };
      const end = timeAt(crash, T);
      expect(multAt(end, T)).toBeCloseTo(crash, 6);
      // Green and Moon light as soon as the climb passes their line, and stay lit.
      let prev = 1;
      for (let t = 0; t <= end; t += end / 50 || 1) {
        const m = Math.min(crash, multAt(t, T));
        expect(m).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = m;
        if (m >= lines.split) expect(winners(crash, lines).green).toBe(true);
        if (m >= lines.moon) expect(winners(crash, lines).moon).toBe(true);
      }
      expect(timeAt(crash, T)).toBeLessThan(T);
    }
  });

  it('auto-bet scaling keeps the mix and the total, so each round is the same 99% bet', () => {
    const base: Stakes = { red: 0.3, green: 1, moon: 0.2 };
    const scaled = scaleStakes(base, 3);
    expect(totalOf(scaled)).toBeCloseTo(3, 12);
    expect(scaled.red / scaled.green).toBeCloseTo(0.3, 12);
    expect(expectedReturn(scaled, { split: 2, moon: 10 })).toBeCloseTo(RTP, 12);
    expect(payoutOf(scaled, 12, { split: 2, moon: 10 })).toBeCloseTo(2 * 2 + 0.4 * 10, 12);
  });

  it('the max multiplier is honest', () => {
    let max = 0;
    for (const lines of ALL_LINES) for (const v of Object.values(payouts(lines))) max = Math.max(max, v);
    expect(max).toBe(1000);
    expect(MAX_MULTIPLIER).toBe(1000);
    expect(manifest.maxMultiplier).toBe(max);
  });

  it('simulated RTP matches the manifest for every config', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
