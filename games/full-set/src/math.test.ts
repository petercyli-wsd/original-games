import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUDGETS,
  MAX_MULTIPLIER,
  RTP,
  SEGMENTS,
  advance,
  averageDraws,
  darkCount,
  darkShare,
  endShares,
  headline,
  huntChance,
  inclusionExclusion,
  litOf,
  prizeFor,
  segmentArc,
  segmentAt,
  winChance,
  type Draw,
} from './math';

const rng = createRng(seededSource(11));

/** Exact k!·S(D, k)/k^D with BigInt Stirling numbers of the second kind. */
function stirlingChance(k: number, D: number): number {
  let row = [1n]; // S(0, ·)
  for (let n = 1; n <= D; n++) {
    const next = new Array<bigint>(Math.min(n, k) + 1).fill(0n);
    for (let j = 1; j < next.length; j++) next[j] = BigInt(j) * (row[j] ?? 0n) + (row[j - 1] ?? 0n);
    row = next;
  }
  let fact = 1n;
  for (let i = 2n; i <= BigInt(k); i++) fact *= i;
  const num = fact * (row[k] ?? 0n);
  const den = BigInt(k) ** BigInt(D);
  const SCALE = 10n ** 30n;
  return Number((num * SCALE) / den) / 1e30;
}

/** A random live state (lit segments, draws left), reached by real draws. */
function randomState(k: (typeof SEGMENTS)[number]) {
  const { min, max } = BUDGETS[k];
  const D = min + rng.int(max - min + 1);
  let lit = new Array<boolean>(k).fill(false);
  let left = D;
  const moves = rng.int(k + 3);
  for (let i = 0; i < moves; i++) {
    const m = darkCount(lit);
    if (m <= 1 || left - 1 < m) break;
    const draws = advance(k, lit, left, 'draw', rng);
    const after = litOf(k, draws);
    const nextLit = lit.map((on, s) => on || after[s]);
    const nm = darkCount(nextLit);
    if (nm === 0 || left - draws.length < nm) break;
    lit = nextLit;
    left -= draws.length;
  }
  return { k, D, lit, m: darkCount(lit), d: left };
}

describe('Full Set maths', () => {
  it('coupon collector: the table equals k!·S(D,k)/k^D and the inclusion–exclusion sum', () => {
    for (const k of SEGMENTS) {
      for (let D = BUDGETS[k].min; D <= BUDGETS[k].max; D++) {
        const exact = stirlingChance(k, D);
        expect(Math.abs(headline(k, D) - exact) / exact).toBeLessThan(1e-12);
      }
      for (let m = 0; m <= k; m++) {
        for (let d = m; d <= BUDGETS[k].max; d++) {
          const w = winChance(k, m, d);
          expect(Math.abs(w - inclusionExclusion(k, m, d)) / w).toBeLessThan(1e-9);
        }
      }
    }
    // Small cases by hand: 4 draws light 4 segments iff they are a permutation.
    expect(headline(4, 4)).toBeCloseTo(24 / 256, 15);
    expect(headline(6, 6)).toBeCloseTo(720 / 6 ** 6, 15);
    expect(averageDraws(6)).toBeCloseTo(14.7, 12);
  });

  it('playing to the end lights the full set exactly as often as the formula says', () => {
    for (const k of SEGMENTS) {
      for (const D of [BUDGETS[k].min + 2, Math.round((BUDGETS[k].min + BUDGETS[k].max) / 2)]) {
        const rounds = 20000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          // The raw process: D independent uniform segments, no game logic.
          const seen = new Set<number>();
          for (let i = 0; i < D; i++) seen.add(rng.int(k));
          if (seen.size === k) wins++;
        }
        const p = headline(k, D);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('each draw is a fair bet: E[cash-out after one draw] = cash-out now', () => {
    for (let trial = 0; trial < 400; trial++) {
      const { k, D, m, d } = randomState(SEGMENTS[trial % SEGMENTS.length]);
      const prize = prizeFor(k, D);
      const now = prize * winChance(k, m, d);
      const after = (m / k) * prize * winChance(k, m - 1, d - 1) + (1 - m / k) * prize * winChance(k, m, d - 1);
      expect(Math.abs(after - now)).toBeLessThan(1e-9 * Math.max(1, now));
    }
  });

  it('each hunt is a fair bet: summing over where the next new segment lands gives the cash-out now', () => {
    for (let trial = 0; trial < 400; trial++) {
      const { k, D, m, d } = randomState(SEGMENTS[trial % SEGMENTS.length]);
      const prize = prizeFor(k, D);
      const p = m / k;
      let after = 0;
      let success = 0;
      for (let g = 1; g <= d - m + 1; g++) {
        const chance = (1 - p) ** (g - 1) * p;
        success += chance;
        after += chance * prize * winChance(k, m - 1, d - g);
      }
      // Failure (no new segment within the spares) pays 0.
      expect(Math.abs(after - prize * winChance(k, m, d))).toBeLessThan(1e-9 * Math.max(1, after));
      expect(success).toBeCloseTo(huntChance(k, m, d), 12);
    }
  });

  it('a simulated hunt from the same state matches its drawn chance and keeps the value', () => {
    const k = 8;
    const lit = [true, true, false, true, false, false, true, false]; // m = 4
    const d = 7; // 3 spares
    const prize = prizeFor(8, 16);
    const rounds = 40000;
    let ok = 0;
    let value = 0;
    for (let r = 0; r < rounds; r++) {
      const draws = advance(k, lit, d, 'hunt', rng);
      const last = draws[draws.length - 1];
      if (last.fresh) {
        ok++;
        value += prize * winChance(k, 3, d - draws.length);
      }
    }
    const p = huntChance(k, 4, d);
    expect(Math.abs(ok / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    const v = prize * winChance(k, 4, d);
    expect(Math.abs(value / rounds - v)).toBeLessThan(0.02 * v + 4 * prize * Math.sqrt(0.25 / rounds));
  });

  it('the dark share of the ring is exactly the chance a draw lights a new segment', () => {
    for (const k of SEGMENTS) {
      for (let trial = 0; trial < 30; trial++) {
        const lit = Array.from({ length: k }, () => rng.next() < 0.5);
        const m = darkCount(lit);
        // Sweep the ring: positions over dark arcs are exactly the new-segment positions.
        const N = 2880;
        let fresh = 0;
        let misplaced = 0;
        for (let i = 0; i < N; i++) {
          const u = (i + 0.5) / N;
          const seg = segmentAt(u, k);
          const arc = segmentArc(seg, k);
          if (!(u >= arc.start && u < arc.start + arc.length)) misplaced++;
          if (!lit[seg]) fresh++;
        }
        expect(misplaced).toBe(0);
        expect(fresh / N).toBeCloseTo(m / k, 12);
        expect(darkShare(lit)).toBeCloseTo(m / k, 12);
      }
    }
  });

  it('a single draw is new with chance m/k (simulation through advance)', () => {
    const k = 12;
    const lit = Array.from({ length: k }, (_, i) => i % 3 === 0); // 4 lit, m = 8
    const rounds = 30000;
    let fresh = 0;
    for (let r = 0; r < rounds; r++) {
      const [draw] = advance(k, lit, 20, 'draw', rng) as [Draw];
      if (draw.fresh) fresh++;
    }
    const p = 8 / 12;
    expect(Math.abs(fresh / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
  });

  it('the end strip: shares sum to 1, the green share is the win chance, and it matches play', () => {
    for (const k of SEGMENTS) {
      for (let m = 0; m <= k; m++) {
        for (let d = Math.max(0, m - 1); d <= BUDGETS[k].max; d += 3) {
          const s = endShares(k, m, d);
          expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
          expect(s[0]).toBeCloseTo(winChance(k, m, d), 12);
          for (let j = m + 1; j <= k; j++) expect(s[j]).toBe(0);
        }
      }
    }
    // Play rounds out move by move and tally how many segments are dark at the end.
    const k = 6;
    const D = 10;
    const rounds = 30000;
    const tally = new Array<number>(k + 1).fill(0);
    for (let r = 0; r < rounds; r++) {
      let lit = new Array<boolean>(k).fill(false);
      let left = D;
      for (;;) {
        const draws = advance(k, lit, left, 'hunt', rng);
        lit = lit.map((on, s) => on || draws.some((x) => x.seg === s));
        left -= draws.length;
        const m = darkCount(lit);
        if (m === 0 || left < m) {
          tally[m]++;
          break;
        }
      }
    }
    const shares = endShares(k, k, D);
    for (let j = 0; j <= k; j++) {
      const p = shares[j];
      expect(Math.abs(tally[j] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('simulated RTP matches the manifest under sampled strategies, and no payout beats the max', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(manifest.rtp).toBe(RTP);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
