import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_PRIZE,
  POINTS,
  RTP,
  WIDTHS,
  binom,
  burstSize,
  clampLo,
  decided,
  loRange,
  median,
  medianDensity,
  outcomes,
  prizeFor,
  sideOf,
  startChance,
  tally,
  winChance,
  type Tally,
} from './math';

const rng = createRng(seededSource(19));

/** Regularised incomplete beta I_x(m+1, m+1), by Simpson integration of the density (independent of math.ts sums). */
function betaCdf(n: number, x: number): number {
  const N = 4000;
  const h = x / N;
  let s = medianDensity(n, 0) + medianDensity(n, x);
  for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * medianDensity(n, i * h);
  return (s * h) / 3;
}

/** Random reachable tallies (not yet decided) with a window. */
function randomStates(count: number) {
  const out: { n: number; t: Tally; a: number; b: number }[] = [];
  while (out.length < count) {
    const n = POINTS[rng.int(POINTS.length)];
    const lo = rng.int(90);
    const b = (lo + 1 + rng.int(100 - lo)) / 100;
    const a = lo / 100;
    const k = rng.int(n);
    const t: Tally = { below: 0, inside: 0, above: 0 };
    for (let i = 0; i < k; i++) t[sideOf(rng.next(), a, b)]++;
    if (!decided(n, t)) out.push({ n, t, a, b });
  }
  return out;
}

describe('Median maths', () => {
  it('the start chance is the Beta(m+1, m+1) mass of the window', () => {
    for (const n of POINTS) {
      for (const [a, b] of [
        [0, 0.5],
        [0.3, 0.4],
        [0.72, 0.82],
        [0.1, 0.9],
        [0.95, 1],
      ]) {
        expect(startChance(n, a, b)).toBeCloseTo(betaCdf(n, b) - betaCdf(n, a), 9);
      }
      // The density integrates to 1, and the whole line always wins.
      expect(betaCdf(n, 1)).toBeCloseTo(1, 9);
      expect(startChance(n, 0, 1)).toBe(1);
    }
    // n = 3: P(median ≤ x) = 3x² − 2x³.
    expect(startChance(3, 0, 0.3)).toBeCloseTo(3 * 0.09 - 2 * 0.027, 12);
  });

  it('the three outcomes (below / in / above) always sum to 1', () => {
    for (const { n, t, a, b } of randomStates(400)) {
      const o = outcomes(n, t, a, b);
      expect(o.low + o.win + o.high).toBeCloseTo(1, 12);
      expect(o.win).toBeGreaterThanOrEqual(0);
    }
  });

  it('the live chance matches a direct simulation of the raw process', () => {
    for (const { n, t, a, b } of randomStates(12)) {
      const p = winChance(n, t, a, b);
      const rounds = 20000;
      const known = [...Array(t.below).fill(a / 2), ...Array(t.inside).fill((a + b) / 2), ...Array(t.above).fill((b + 1) / 2)];
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const pts = known.slice();
        while (pts.length < n) pts.push(rng.next());
        const med = median(pts);
        if (med >= a && med <= b) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('the start chance matches simulated medians for every point count', () => {
    for (const n of POINTS) {
      const [a, b] = [0.42, 0.61];
      const p = startChance(n, a, b);
      const rounds = 20000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const pts = Array.from({ length: n }, () => rng.next());
        const med = median(pts);
        if (med >= a && med <= b) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('each point is a fair bet: E[chance after] = chance now', () => {
    for (const { n, t, a, b } of randomStates(500)) {
      const now = winChance(n, t, a, b);
      const next =
        a * winChance(n, { ...t, below: t.below + 1 }, a, b) +
        (b - a) * winChance(n, { ...t, inside: t.inside + 1 }, a, b) +
        (1 - b) * winChance(n, { ...t, above: t.above + 1 }, a, b);
      expect(next).toBeCloseTo(now, 11);
    }
  });

  it('a whole burst is a fair bet too (exact enumeration, stopping when decided)', () => {
    const expectAfter = (n: number, t: Tally, a: number, b: number, k: number): number => {
      if (k === 0 || decided(n, t)) return winChance(n, t, a, b);
      return (
        a * expectAfter(n, { ...t, below: t.below + 1 }, a, b, k - 1) +
        (b - a) * expectAfter(n, { ...t, inside: t.inside + 1 }, a, b, k - 1) +
        (1 - b) * expectAfter(n, { ...t, above: t.above + 1 }, a, b, k - 1)
      );
    };
    for (const { n, t, a, b } of randomStates(60)) {
      expect(expectAfter(n, t, a, b, burstSize(n))).toBeCloseTo(winChance(n, t, a, b), 11);
    }
  });

  it('the tug of war is the median: win iff neither side reaches m + 1', () => {
    for (let trial = 0; trial < 3000; trial++) {
      const n = POINTS[rng.int(POINTS.length)];
      const a = rng.next() * 0.8;
      const b = a + rng.next() * (1 - a);
      const pts = Array.from({ length: n }, () => rng.next());
      const t = tally(pts, a, b);
      const med = median(pts);
      expect(decided(n, t)).toBe(med >= a && med <= b ? 'win' : 'bust');
      // Decided early only when the rest cannot change it.
      for (let k = 0; k < n; k++) {
        const d = decided(n, tally(pts.slice(0, k), a, b));
        if (d) expect(d).toBe(decided(n, t));
      }
    }
  });

  it('the drawn outcome bar is the true risk: its shares are exact outcome frequencies', () => {
    const n = 9;
    const [a, b] = [0.35, 0.55];
    const t: Tally = { below: 2, inside: 1, above: 1 };
    const o = outcomes(n, t, a, b);
    const rounds = 30000;
    const counts = { low: 0, win: 0, high: 0 };
    const known = [0.1, 0.2, 0.4, 0.8];
    for (let r = 0; r < rounds; r++) {
      const pts = known.slice();
      while (pts.length < n) pts.push(rng.next());
      const med = median(pts);
      counts[med < a ? 'low' : med > b ? 'high' : 'win']++;
    }
    for (const k of ['low', 'win', 'high'] as const) {
      const p = o[k];
      expect(Math.abs(counts[k] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('allowed windows keep the prize under the cap, and the range is an interval', () => {
    for (const n of POINTS) {
      for (const width of WIDTHS) {
        const { min, max } = loRange(n, width);
        expect(min).toBeLessThanOrEqual(max);
        expect(min + max).toBe(100 - width); // symmetric about the centre
        for (let lo = min; lo <= max; lo++) expect(prizeFor({ n, width, lo })).toBeLessThanOrEqual(MAX_PRIZE);
        if (min > 0) expect(prizeFor({ n, width, lo: min - 1 })).toBeGreaterThan(MAX_PRIZE);
        expect(clampLo(n, width, -5)).toBe(min);
        expect(clampLo(n, width, 200)).toBe(max);
      }
    }
    expect(binom(25, 12)).toBe(5200300);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
