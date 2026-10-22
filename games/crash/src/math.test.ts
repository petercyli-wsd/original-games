import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CAP,
  MAX_MULTIPLIER,
  MAX_TARGET,
  MIN_TARGET,
  RTP,
  autoEnd,
  cashAt,
  centsAt,
  clampTarget,
  crashCents,
  endTime,
  multAt,
  nextMilestone,
  payoutOf,
  reachChance,
  targetForChance,
  targetTime,
  timeTo,
  winChance,
} from './math';

describe('Crash maths', () => {
  it('P(C ≥ k) = 99/k exactly: the crash point flips at U = 99/k', () => {
    // floor(99/U) ≥ k ⟺ U ≤ 99/k, so the set of winning draws is [0, 99/k].
    for (const k of [99, 100, 101, 150, 200, 1000, 12345, 1_000_000, CAP]) {
      const edge = 99 / k;
      expect(crashCents(edge)).toBeGreaterThanOrEqual(k);
      expect(crashCents(edge * (1 + 1e-12) + 1e-15)).toBeLessThan(k === 99 ? 100 : k);
      expect(reachChance(k)).toBeCloseTo(edge, 15);
    }
    expect(crashCents(0)).toBe(CAP);
    expect(crashCents(0.999999)).toBe(99); // instant crash
    // An instant crash (C < 1.00×) is exactly the 1% of draws above 0.99.
    expect(1 - reachChance(100)).toBeCloseTo(0.01, 15);
  });

  it('every auto cash-out target returns exactly the RTP (closed form)', () => {
    for (const t of [MIN_TARGET, 150, 200, 333, 1000, 10_000, 1_000_000, MAX_TARGET]) {
      expect(winChance(t) * (t / 100)).toBeCloseTo(RTP, 12);
    }
  });

  it('the cash-out value is a martingale from cent to cent', () => {
    // V(k) = k/100 while flying; V(k+1)·P(C ≥ k+1 | C ≥ k) = V(k).
    for (const k of [100, 101, 137, 999, 54_321, CAP - 1]) {
      const cond = reachChance(k + 1) / reachChance(k);
      expect((((k + 1) / 100) * cond) / (k / 100)).toBeCloseTo(1, 12);
    }
  });

  it('the cap is a stopping rule: never clicking returns 99% too', () => {
    // Paid only when C reaches the cap, which happens with probability 99/CAP.
    expect(reachChance(CAP) * MAX_MULTIPLIER).toBeCloseTo(RTP, 12);
    expect(autoEnd(null, CAP)).toEqual({ kind: 'max', cents: CAP });
    expect(autoEnd(null, CAP - 1)).toEqual({ kind: 'crashed' });
  });

  it('simulated crash points match the survival curve (4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 400_000;
    const levels = [100, 101, 200, 500, 1000, 5000];
    const hits = levels.map(() => 0);
    for (let i = 0; i < n; i++) {
      const c = crashCents(rng.next());
      levels.forEach((k, j) => c >= k && hits[j]++);
    }
    levels.forEach((k, j) => {
      const p = 99 / k;
      expect(Math.abs(hits[j] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    });
  });

  it('the clock and the cents agree: a click before the crash is paid, never above C', () => {
    const rng = createRng(seededSource(5));
    for (let i = 0; i < 20_000; i++) {
      const c = crashCents(rng.next());
      const end = endTime(c);
      if (c < CAP) {
        // Just before the end the curve shows at most C; at the end it has crashed.
        if (end > 0) expect(cashAt(end - 1e-6, c)).toBeLessThanOrEqual(c);
        expect(cashAt(end, c)).toBe(0);
        if (c >= 100) expect(cashAt(end - 1e-6, c)).toBe(Math.max(100, c));
      }
      const tau = rng.next() * end;
      const k = cashAt(tau, c);
      expect(k === 0 || k <= c).toBe(true);
    }
    // At the target's time the curve shows the target exactly.
    for (const t of [101, 200, 257, 1000, 99_999]) expect(centsAt(targetTime(t))).toBe(t);
    expect(multAt(timeTo(2))).toBeCloseTo(2, 12);
    expect(timeTo(2)).toBeCloseTo(Math.log(2) / 0.00006, 9);
  });

  it('manual clicks at random times return 99% (simulation, 4 SE)', () => {
    const rng = createRng(seededSource(21));
    const n = 300_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const c = crashCents(rng.next());
      // A click at a uniformly random moment in the first 40 s.
      const tau = Math.max(targetTime(MIN_TARGET), rng.next() * 40_000);
      const m = cashAt(tau, c) / 100;
      sum += m;
      sq += m * m;
    }
    const mean = sum / n;
    const se = Math.sqrt((sq / n - mean * mean) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });

  it('auto play resolves once per round, to the right payout', () => {
    expect(autoEnd(200, 199)).toEqual({ kind: 'crashed' });
    expect(autoEnd(200, 200)).toEqual({ kind: 'cashed', cents: 200 }); // tie: C ≥ target wins
    expect(autoEnd(200, 99)).toEqual({ kind: 'crashed' });
    expect(payoutOf(150, 151)).toBe(1.5);
    expect(payoutOf(150, 149)).toBe(0);
    // The auto target fires strictly before the crash time when C ≥ target.
    for (const [t, c] of [[200, 200], [101, 5000], [1000, 1000]]) expect(targetTime(t)).toBeLessThan(endTime(c));
  });

  it('inputs round-trip and stay in range', () => {
    expect(clampTarget(2)).toBe(200);
    expect(clampTarget(1)).toBe(MIN_TARGET);
    expect(clampTarget(1e9)).toBe(MAX_TARGET);
    expect(clampTarget(2.345)).toBe(235);
    expect(targetForChance(49.5)).toBe(200);
    expect(targetForChance(99)).toBe(MIN_TARGET);
    expect(nextMilestone(100)).toBe(150);
    expect(nextMilestone(200)).toBe(300);
    expect(nextMilestone(999)).toBe(1000);
    expect(nextMilestone(1000)).toBe(2000);
  });

  it('simulated RTP matches the manifest, and the max is honest', () => {
    for (const r of runEval(evalSpec, { rounds: 100_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(MAX_MULTIPLIER).toBe(1_000_000);
  });
});
