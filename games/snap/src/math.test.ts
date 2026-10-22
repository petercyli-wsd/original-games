import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BREAK_MAX,
  BREAK_MIN,
  CUTS,
  HALF,
  MAX_MULTIPLIER,
  RTP,
  cutsLeft,
  headline,
  heightAt,
  isPolygon,
  landscape,
  landscapeArea,
  longPiece,
  pieces,
  polygonSides,
  prizeFor,
  snapBreak,
  winChance,
  winChanceSum,
  winZone,
} from './math';

const rng = createRng(seededSource(11));

/** The raw rule, straight from the pieces: what the chance becomes if the next cut lands at u. */
const chanceAfterCut = (breaks: number[], m: number, u: number) => winChance(longPiece([...breaks, u])?.length ?? null, m - 1);

/** A random live state: a break, then some cuts that left a long piece and at least one cut to come. */
function randomLiveState() {
  for (;;) {
    const k = CUTS[rng.int(CUTS.length)];
    const breaks = [snapBreak(BREAK_MIN + rng.int(BREAK_MAX)) / 100];
    const fell = rng.int(k);
    for (let i = 0; i < fell; i++) breaks.push(rng.next());
    const m = cutsLeft(breaks, k);
    if (longPiece(breaks) && m >= 1) return { breaks, m, k };
  }
}

// 3-point Gauss–Legendre: exact for polynomials up to degree 5 on each piece.
const GL = [
  [-Math.sqrt(3 / 5), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(3 / 5), 5 / 9],
] as const;

/** E[chance after the next cut], integrated exactly over every stretch where the raw rule is linear. */
function expectedNext(breaks: number[], m: number) {
  const long = longPiece(breaks)!;
  const knots = [0, 1, ...breaks, long.start + HALF, long.end - HALF].filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b);
  let e = 0;
  for (let i = 0; i + 1 < knots.length; i++) {
    const [a, b] = [knots[i], knots[i + 1]];
    if (b - a < 1e-15) continue;
    for (const [t, w] of GL) e += ((b - a) / 2) * w * chanceAfterCut(breaks, m, (a + b) / 2 + ((b - a) / 2) * t);
  }
  return e;
}

describe('Snap maths', () => {
  it('the closed form equals the spec sum Σ Bin(j; m, ℓ)·S(j, ℓ)', () => {
    // ℓ = ½ exactly is the tie point (a piece of exactly ½ counts as long), so start just above it.
    let worst = 0;
    for (let m = 0; m <= 6; m++) {
      for (let l = 0.5 + 1e-9; l < 1; l += 0.00731) worst = Math.max(worst, Math.abs(winChance(l, m) - winChanceSum(l, m)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('recovers the classic broken stick and Wendel: m cuts of a whole stick fail with chance (m+1)/2^m', () => {
    expect(winChance(1, 2)).toBeCloseTo(1 / 4, 14); // two random cuts make a triangle a quarter of the time
    for (let n = 2; n <= 8; n++) expect(1 - winChance(1, n - 1)).toBeCloseTo(n / 2 ** (n - 1), 14);
  });

  it('a direct simulation of the raw process forms a polygon as often as the formula says', () => {
    for (const pct of [3, 20, 45, 62, 90]) {
      for (const k of CUTS) {
        const x = pct / 100;
        const rounds = 20_000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const breaks = [x];
          for (let i = 0; i < k; i++) breaks.push(rng.next());
          if (Math.max(...pieces(breaks).map((p) => p.length)) < HALF) wins++;
        }
        const p = headline(x, k);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('each cut is a fair bet: E[cash-out after the cut] = cash-out now', () => {
    for (let trial = 0; trial < 400; trial++) {
      const { breaks, m, k } = randomLiveState();
      const prize = prizeFor(breaks[0], k);
      const now = prize * winChance(longPiece(breaks)!.length, m);
      expect(prize * expectedNext(breaks, m)).toBeCloseTo(now, 11);
    }
  });

  it('the drawn landscape is the true next chance, and its green area is the chance now', () => {
    for (let trial = 0; trial < 200; trial++) {
      const { breaks, m } = randomLiveState();
      const zones = landscape(breaks, m);
      const long = longPiece(breaks)!;
      // The zones tile the stick.
      expect(zones[0].start).toBe(0);
      expect(zones[zones.length - 1].end).toBeCloseTo(1, 15);
      // Area = chance now.
      expect(landscapeArea(zones)).toBeCloseTo(winChance(long.length, m), 12);
      // Sweep the stick: the drawn height is what the cut would really give.
      const green = winZone(breaks)!;
      let greenHits = 0;
      let worst = 0;
      let mismatched = 0;
      const N = 1000;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        const nearEdge = [...breaks, green.start, green.end].some((t) => Math.abs(t - u) < 1e-9);
        if (nearEdge) continue;
        worst = Math.max(worst, Math.abs(heightAt(zones, u) - chanceAfterCut(breaks, m, u)));
        const polygonNow = isPolygon([...breaks, u]);
        if (polygonNow !== (u > green.start && u < green.end)) mismatched++;
        if (polygonNow) greenHits++;
      }
      expect(worst).toBeLessThan(1e-12);
      expect(mismatched).toBe(0);
      // The green stretch is 1 − ℓ long: the chance the next cut finishes it at once.
      expect(green.end - green.start).toBeCloseTo(1 - long.length, 12);
      expect(Math.abs(greenHits / N - (1 - long.length))).toBeLessThan(2 / N);
      // On the last cut the landscape is only the green column.
      if (m === 1) expect(landscapeArea(zones)).toBeCloseTo(1 - long.length, 12);
    }
  });

  it('your break changes volatility, never value: every setting starts at RTP', () => {
    for (const k of CUTS) {
      for (let pct = BREAK_MIN; pct <= BREAK_MAX; pct++) {
        if (pct === 50) continue;
        const x = pct / 100;
        expect(prizeFor(x, k) * headline(x, k)).toBeCloseTo(RTP, 12);
        expect(headline(x, k)).toBeCloseTo(headline(1 - x, k), 12);
        expect(prizeFor(x, k)).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    expect(snapBreak(50, 51)).toBe(49);
    expect(snapBreak(50, 49)).toBe(51);
    expect(snapBreak(49.7)).toBe(49);
    expect(MAX_MULTIPLIER).toBeCloseTo(99, 9);
  });

  it('the winning polygon is drawn with exactly your pieces as its sides', () => {
    let checked = 0;
    while (checked < 300) {
      const breaks = [rng.next(), rng.next(), rng.next(), rng.next()].slice(0, 2 + rng.int(3));
      if (!isPolygon(breaks)) continue;
      const lens = pieces(breaks).map((p) => p.length);
      const sides = polygonSides(lens);
      sides.forEach((s, i) => {
        expect(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).toBeCloseTo(lens[i], 7);
        const next = sides[(i + 1) % sides.length];
        expect(Math.hypot(next.x1 - s.x2, next.y1 - s.y2)).toBeLessThan(1e-7);
      });
      checked++;
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
