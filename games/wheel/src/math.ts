// Wheel (Stake, BC.Game, Shuffle…): a wheel of N equal segments (N = 10, 20,
// 30, 40 or 50) is spun and stops on one segment, chosen uniformly at random:
//
//     P(segment i) = 1 / N.
//
// Each segment carries a multiplier, so a multiplier m printed on c of the N
// segments is hit with probability c / N, which is exactly its share of the
// wheel's circumference (the arc length on screen *is* the odds). The RTP of a
// (risk, segments) table is the average multiplier over its segments:
//
//     RTP(risk, N) = (1/N) · Σᵢ mᵢ = (1/N) · Σ_m  m · count(m).
//
// Every table below is written in hundredths and chosen so that
//
//     Σ_m  (100·m) · count(m) = 99 · N        (integer identity)
//
// which makes RTP = 99.00% exactly, with no rounding anywhere. The three risks
// follow the format's familiar patterns:
//
//   Low    per 10 segments: 1.20× ×7, 1.50× ×1, 0× ×2
//          (7·120 + 150 = 990 = 99·10).
//   Medium half the wheel is 0×; the other half mixes 1.5×–5× prizes
//          (e.g. 10 segments: 1.5× ×2, 1.9×, 2×, 3× → 300+190+200+300 = 990).
//   High   one jackpot segment paying 0.99·N (9.90× … 49.50×), the rest 0×
//          (0.99·N · 1 = 0.99·N).
//
// Risk and segment count only reshape the distribution (volatility, from an
// 80% hit rate down to 2%); every setting is worth exactly RTP = 0.99 per spin.
// The segment is drawn from the RNG when the spin starts, and the animation just
// turns the wheel to it. The landing point inside the segment is cosmetic.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Risk = 'low' | 'medium' | 'high';
export const RISKS: Risk[] = ['low', 'medium', 'high'];
export const SEGMENTS = [10, 20, 30, 40, 50] as const;
export type Segments = (typeof SEGMENTS)[number];

/** Medium-risk tables as [multiplier in hundredths, count]. */
const MEDIUM: Record<Segments, [number, number][]> = {
  10: [[0, 5], [150, 2], [190, 1], [200, 1], [300, 1]],
  20: [[0, 10], [150, 2], [180, 1], [200, 6], [300, 1]],
  30: [[0, 15], [150, 6], [170, 1], [200, 6], [300, 1], [400, 1]],
  40: [[0, 20], [150, 8], [160, 1], [200, 7], [300, 4]],
  50: [[0, 25], [150, 13], [200, 8], [300, 3], [500, 1]],
};

/** A table's distinct multipliers, in hundredths, with how many segments carry each. */
export function countsFor(risk: Risk, n: Segments): [number, number][] {
  if (risk === 'low') {
    const k = n / 10;
    return [[0, 2 * k], [120, 7 * k], [150, k]];
  }
  if (risk === 'high') return [[0, n - 1], [99 * n, 1]];
  return MEDIUM[n];
}

export interface Entry {
  /** Payout multiplier. */
  mult: number;
  /** Multiplier in hundredths (exact integer). */
  hundredths: number;
  /** Segments carrying it. */
  count: number;
  /** count / N: the exact chance, and the share of the wheel. */
  prob: number;
}

export interface WheelTable {
  risk: Risk;
  segments: Segments;
  /** Distinct multipliers, lowest first. */
  entries: Entry[];
  /** Multiplier of each segment, clockwise from the top. */
  layout: number[];
  /** Index into `entries` for each segment. */
  layoutEntry: number[];
  max: number;
  /** P(multiplier > 1). */
  chanceProfit: number;
  /** P(multiplier > 0). */
  chanceHit: number;
  /** Exact RTP as Σ hundredths·count / (100·N). */
  rtp: number;
  stdDev: number;
}

/**
 * Spreads the segments around the wheel so equal multipliers are evenly spaced:
 * at each slot, place the multiplier that is furthest behind its fair share
 * (count · slots so far / N). Deterministic, so a setting always looks the same.
 */
export function spreadLayout(counts: number[]): number[] {
  const n = counts.reduce((a, b) => a + b, 0);
  const placed = counts.map(() => 0);
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    let best = -1;
    let bestDeficit = -Infinity;
    for (let c = 0; c < counts.length; c++) {
      if (placed[c] >= counts[c]) continue;
      const deficit = (counts[c] * (t + 1)) / n - placed[c];
      if (deficit > bestDeficit + 1e-12) {
        bestDeficit = deficit;
        best = c;
      }
    }
    placed[best]++;
    out.push(best);
  }
  return out;
}

const cache = new Map<string, WheelTable>();

export function tableFor(risk: Risk, n: Segments): WheelTable {
  const key = `${risk}:${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = [...countsFor(risk, n)].sort((a, b) => a[0] - b[0]);
  const entries: Entry[] = raw.map(([h, count]) => ({ mult: h / 100, hundredths: h, count, prob: count / n }));
  let layoutEntry: number[];
  if (risk === 'medium') {
    // Half the wheel is 0×: alternate 0× with the prizes, which are spread among themselves.
    const prizes = spreadLayout(entries.slice(1).map((e) => e.count)).map((i) => i + 1);
    layoutEntry = prizes.flatMap((p) => [0, p]);
  } else {
    layoutEntry = spreadLayout(entries.map((e) => e.count));
  }
  const layout = layoutEntry.map((i) => entries[i].mult);
  const sumH = raw.reduce((s, [h, c]) => s + h * c, 0);
  const rtp = sumH / (100 * n);
  const ex2 = entries.reduce((s, e) => s + e.prob * e.mult * e.mult, 0);
  const table: WheelTable = {
    risk,
    segments: n,
    entries,
    layout,
    layoutEntry,
    max: entries[entries.length - 1].mult,
    chanceProfit: entries.filter((e) => e.mult > 1).reduce((s, e) => s + e.count, 0) / n,
    chanceHit: entries.filter((e) => e.mult > 0).reduce((s, e) => s + e.count, 0) / n,
    rtp,
    stdDev: Math.sqrt(Math.max(0, ex2 - rtp * rtp)),
  };
  cache.set(key, table);
  return table;
}

/** Σ (hundredths · count) for a table; RTP is exactly 99% iff this equals 99·N. */
export const hundredthsSum = (risk: Risk, n: Segments) => countsFor(risk, n).reduce((s, [h, c]) => s + h * c, 0);

/** Largest prize on any table: High risk, 50 segments, 0.99 · 50. */
export const MAX_MULTIPLIER = 49.5;

export function volatilityOf(risk: Risk, n: Segments): Volatility {
  if (risk === 'low') return 'low';
  if (risk === 'medium') return 'medium';
  return n <= 20 ? 'high' : 'extreme';
}

/** The segment for a uniform u ∈ [0, 1). */
export const segmentFor = (u: number, n: number) => Math.min(n - 1, Math.floor(u * n));

/**
 * One spin: draws the segment (uniform), then a cosmetic landing point inside
 * it (kept away from the edges so the pointer is clearly inside). Two RNG draws.
 */
export function spin(next: () => number, table: WheelTable) {
  const index = segmentFor(next(), table.segments);
  const offset = 0.18 + 0.64 * next();
  return { index, offset, multiplier: table.layout[index] };
}

/** Text colour for a multiplier label (0× needs more contrast than its segment). */
export const labelColourFor = (mult: number, risk: Risk) => (mult === 0 ? '#9ea3b6' : colourFor(mult, risk));

/** Segment colour for a multiplier on a given risk (only the palette, no maths). */
export function colourFor(mult: number, risk: Risk): string {
  if (mult === 0) return '#363c4f';
  if (risk === 'high') return '#facc15';
  if (mult === 1.2) return '#38bdf8';
  if (mult === 1.5) return '#22c55e';
  if (mult < 2) return '#2dd4bf';
  if (mult === 2) return '#f59e0b';
  if (mult === 3) return '#a855f7';
  if (mult === 4) return '#ec4899';
  return '#ef4444';
}
