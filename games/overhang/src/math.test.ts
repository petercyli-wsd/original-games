import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MODES,
  MODE_NAMES,
  RTP,
  drawOffset,
  failingLevel,
  isStable,
  landsSafely,
  maxMultiplier,
  nextOdds,
  safeInterval,
  simulate,
  type Mode,
} from './math';

/** Builds a random standing tower of n blocks by rejection sampling offsets. */
function randomTower(n: number, s: number, next: () => number): number[] {
  const xs: number[] = [];
  let tries = 0;
  while (xs.length < n && tries++ < 10_000) {
    const top = xs.length ? xs[xs.length - 1] : 0;
    const cand = [...xs, top + drawOffset(s, next())];
    if (isStable(cand)) xs.push(cand[cand.length - 1]);
  }
  return xs;
}

/** Mean and z-score against RTP of `rounds` plays of a strategy. */
function measure(mode: Mode, stop: (h: number, m: number) => boolean, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const { multiplier } = simulate(mode, stop, rng.next);
    sum += multiplier;
    sumSq += multiplier ** 2;
    max = Math.max(max, multiplier);
  }
  const mean = sum / rounds;
  const se = Math.sqrt((sumSq / rounds - mean ** 2) / rounds);
  return { mean, z: (mean - RTP) / se, max };
}

describe('Overhang statics', () => {
  it('a bare pedestal accepts offsets within half a block', () => {
    expect(safeInterval([])).toEqual([-0.5, 0.5]);
  });

  it('matches a hand-worked two-level example', () => {
    // Block at 0.4 on the pedestal. Top level: d ∈ [-0.5, 0.5]. Pedestal: the
    // pair's centre (0.4 + 0.4 + d) / 2 must be within ±0.5, so d ≤ 0.2.
    const [lo, hi] = safeInterval([0.4]);
    expect(lo).toBeCloseTo(-0.5, 12);
    expect(hi).toBeCloseTo(0.2, 12);
  });

  it('the analytic safe interval agrees with brute-force stability checks', () => {
    const rng = createRng(seededSource(7));
    for (let t = 0; t < 300; t++) {
      const s = 0.4 + rng.next() * 1.2;
      const xs = randomTower(1 + rng.int(18), s, rng.next);
      const top = xs[xs.length - 1];
      const [lo, hi] = safeInterval(xs);
      for (let k = 0; k <= 600; k++) {
        const d = -3 + (6 * k) / 600;
        // Skip offsets on the boundary itself, where rounding decides.
        if (Math.abs(d - lo) < 1e-9 || Math.abs(d - hi) < 1e-9) continue;
        expect(isStable([...xs, top + d])).toBe(d >= lo && d <= hi);
      }
    }
  });

  it('p is the share of the drop range that stands', () => {
    const rng = createRng(seededSource(11));
    for (let t = 0; t < 200; t++) {
      const s = MODES[MODE_NAMES[t % MODE_NAMES.length]].s;
      const xs = randomTower(1 + rng.int(14), s, rng.next);
      const top = xs[xs.length - 1];
      const odds = nextOdds(xs, s);
      const K = 2000;
      let standing = 0;
      for (let k = 0; k < K; k++) {
        const d = drawOffset(s, (k + 0.5) / K);
        expect(landsSafely(odds, d)).toBe(isStable([...xs, top + d]));
        if (landsSafely(odds, d)) standing++;
      }
      expect(Math.abs(standing / K - odds.p)).toBeLessThanOrEqual(1 / K + 1e-12);
    }
  });

  it('can produce a tower that takes no further block', () => {
    // Eight blocks summing to 3.85 (centre of mass 0.48, just on the pedestal).
    // The pedestal needs the ninth centre ≤ 9 × 0.5 − 3.85 = 0.65; the top
    // block needs it ≥ 1.2 − 0.5 = 0.7. The safe set is empty, so p = 0.
    const xs = [0.35, 0.1, 0.15, 0.25, 0.5, 0.6, 0.7, 1.2];
    expect(isStable(xs)).toBe(true);
    expect(nextOdds(xs, 1).p).toBe(0);
  });

  it('reports the lowest failing level and the side it tips to', () => {
    expect(failingLevel([0.4, 1.3])).toEqual({ level: 0, dir: 1 });
    expect(failingLevel([0, -0.6])).toEqual({ level: 1, dir: -1 });
    expect(failingLevel([0.3, 0.6])).toBeNull();
  });
});

describe('Overhang payouts', () => {
  it('cashing out at a fixed height is worth RTP', () => {
    for (const mode of MODE_NAMES) {
      for (const k of [1, 2, 3, 5]) {
        const { z } = measure(mode, (h) => h >= k, 100_000, 100 + k);
        expect(Math.abs(z)).toBeLessThan(4);
      }
    }
  });

  it('playing until the round auto-cashes is worth RTP and never beats the cap', () => {
    for (const mode of MODE_NAMES) {
      const { z, max } = measure(mode, () => false, 200_000, 9);
      expect(Math.abs(z)).toBeLessThan(4);
      expect(max).toBeLessThanOrEqual(MODES[mode].cap);
    }
  });

  it('the first drop never auto-cashes', () => {
    for (const mode of MODE_NAMES) {
      const { s, pMin, cap } = MODES[mode];
      const p0 = nextOdds([], s).p;
      expect(p0).toBeCloseTo(Math.min(1, 0.5 / s), 12);
      expect(p0).toBeGreaterThanOrEqual(pMin);
      expect(RTP / p0).toBeLessThanOrEqual(cap);
    }
  });

  it('auto-cashes at the height cap, on poor odds and before passing the payout cap', () => {
    const rng = createRng(seededSource(3));
    const seen = new Set<string>();
    for (const mode of MODE_NAMES) {
      for (let i = 0; i < 40_000; i++) {
        const r = simulate(mode, () => false, rng.next);
        if (r.auto) seen.add(r.auto);
        if (r.auto === 'height') expect(r.drops).toBe(MODES[mode].maxHeight);
        expect(r.drops).toBeLessThanOrEqual(MODES[mode].maxHeight);
      }
    }
    expect([...seen].sort()).toEqual(['cap', 'height', 'odds']);
  });
});

describe('Overhang manifest', () => {
  it('maxMultiplier covers every mode', () => {
    expect(manifest.maxMultiplier).toBe(Math.max(...MODE_NAMES.map(maxMultiplier)));
    expect(manifest.volatility).toEqual(MODE_NAMES);
    expect(manifest.rtp).toBe(RTP);
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
