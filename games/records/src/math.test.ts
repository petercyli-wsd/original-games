import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { ITEM_ROW, ROW, ROW_W, markerX, slotCell } from './geometry';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  N,
  RTP,
  TARGETS,
  VOLATILITY,
  countRecords,
  drawRank,
  harmonic,
  headline,
  isRecord,
  outOfReach,
  prizeFor,
  recordChance,
  tailTable,
  volatilityOf,
  winChance,
} from './math';

const rng = createRng(seededSource(11));
const within4se = (hits: number, trials: number, p: number) =>
  expect(Math.abs(hits / trials - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / trials) + 1e-9);

/** Left-to-right maxima of a uniformly shuffled queue: the raw process, no slots involved. */
function recordsInShuffle(n: number) {
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  let best = -1;
  let r = 0;
  for (const v of order) if (v > best) (best = v), r++;
  return r;
}

/** A random live state (j items seen, r records) reached by actually dropping items. */
function randomLiveState(k: number) {
  for (;;) {
    const stop = 1 + rng.int(N - 1);
    let j = 0;
    let r = 0;
    while (j < stop) {
      j++;
      if (isRecord(drawRank(j, rng), j)) r++;
    }
    if (r < k && !outOfReach(k, j, r)) return { j, r };
  }
}

describe('Records maths', () => {
  it('closed form: P(exactly m records) = c(n, m) / n!, the unsigned Stirling numbers of the first kind', () => {
    for (const n of [10, N, 50]) {
      // c(i+1, m) = i·c(i, m) + c(i, m−1)
      let c: bigint[] = [1n];
      for (let i = 0; i < n; i++) {
        const next = Array<bigint>(c.length + 1).fill(0n);
        c.forEach((v, m) => {
          next[m] += BigInt(i) * v;
          next[m + 1] += v;
        });
        c = next;
      }
      const fact = c.reduce((a, b) => a + b, 0n); // Σ c(n, m) = n!
      const t = tailTable(n)[0];
      for (let m = 1; m <= Math.min(n, 20); m++) {
        const exact = Number((c[m] * 10n ** 30n) / fact) / 1e30;
        const dp = t[m] - t[m + 1];
        expect(Math.abs(dp - exact)).toBeLessThan(1e-12 + 1e-9 * exact);
      }
      // Mean H_n.
      let mean = 0;
      for (let m = 1; m <= n; m++) mean += m * (t[m] - t[m + 1]);
      expect(mean).toBeCloseTo(harmonic(n), 10);
    }
  });

  it('the headline chance matches shuffling the queue and counting records (and permutation cycles: Foata)', () => {
    const trials = 20_000;
    const sample = Array.from({ length: trials }, () => recordsInShuffle(N));
    for (const k of TARGETS) within4se(sample.filter((r) => r >= k).length, trials, headline(k));
    // Cycles of a random permutation have the same law as records.
    const cyc = Array.from({ length: trials }, () => {
      const perm = rng.shuffle(Array.from({ length: N }, (_, i) => i));
      const seen = new Uint8Array(N);
      let cycles = 0;
      for (let i = 0; i < N; i++) {
        if (seen[i]) continue;
        cycles++;
        for (let x = i; !seen[x]; x = perm[x]) seen[x] = 1;
      }
      return cycles;
    });
    for (const k of [3, 5, 7]) within4se(cyc.filter((c) => c >= k).length, trials, headline(k));
  });

  it('one knob: every target has a headline chance in [0.1%, 95%], spanning more than 25:1', () => {
    for (const k of TARGETS) {
      expect(headline(k)).toBeGreaterThanOrEqual(0.001);
      expect(headline(k)).toBeLessThanOrEqual(0.95 + 1e-12);
    }
    expect(headline(TARGETS[0]) / headline(TARGETS[TARGETS.length - 1])).toBeGreaterThan(25);
    const ps = Object.values(VOLATILITY).map(({ k }) => headline(k));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const [level, { k }] of Object.entries(VOLATILITY)) expect(volatilityOf(k)).toBe(level);
  });

  it('martingale: the next item is a fair bet at random reachable states (exact to 1e-12)', () => {
    for (const k of TARGETS) {
      for (let trial = 0; trial < 60; trial++) {
        const { j, r } = randomLiveState(k);
        const now = winChance(k, j, r);
        const q = recordChance(j + 1);
        const after = q * winChance(k, j + 1, r + 1) + (1 - q) * winChance(k, j + 1, r);
        expect(after).toBeCloseTo(now, 12);
        const prize = prizeFor(k);
        expect(prize * after).toBeCloseTo(prize * now, 9);
      }
      // At the start the cash-out is exactly RTP, and item 1 (always a record) keeps it there.
      expect(prizeFor(k) * winChance(k, 0, 0)).toBeCloseTo(RTP, 12);
      expect(prizeFor(k) * winChance(k, 1, 1)).toBeCloseTo(RTP, 12);
    }
  });

  it('the drop follows the priced law: item t lands in each of its t slots equally often', () => {
    for (const t of [1, 2, 5, 13, 20]) {
      const trials = 20_000;
      const counts = new Array(t + 1).fill(0);
      for (let i = 0; i < trials; i++) counts[drawRank(t, rng)]++;
      expect(counts[0]).toBe(0);
      for (let s = 1; s <= t; s++) within4se(counts[s], trials, 1 / t);
      within4se(counts[t], trials, recordChance(t));
    }
    expect(countRecords([1, 2, 1, 4, 3])).toBe(3);
  });

  it('what is drawn as the odds is the true risk: the green slot is 1/t of the row; the row has one marker per item', () => {
    for (let t = 1; t <= N; t++) {
      const top = slotCell(t, t);
      // The green slot ends the row and its share of the row is the record chance.
      expect(top.x + top.w).toBeCloseTo(ROW.x1, 9);
      expect(top.w / ROW_W).toBeCloseTo(recordChance(t), 12);
      // The t slots are equal and tile the row exactly.
      expect(slotCell(t, 1).x).toBeCloseTo(ROW.x0, 9);
      for (let s = 1; s < t; s++) {
        expect(slotCell(t, s).w).toBeCloseTo(top.w, 12);
        expect(slotCell(t, s).x + slotCell(t, s).w).toBeCloseTo(slotCell(t, s + 1).x, 9);
      }
    }
    expect(markerX(N, 1)).toBeGreaterThan(ITEM_ROW.x0);
    expect(markerX(N, N)).toBeLessThan(ITEM_ROW.x1);
  });

  it('optional stopping, exactly: any state-based stopping rule is worth RTP (no simulation)', () => {
    type Rule = (j: number, r: number, p: number) => boolean;
    const rules: Rule[] = [
      () => false,
      (j) => j >= 6,
      (_j, r, p) => p < 0.5 * winChance(5, 1, 1) || r >= 3,
      (j, _r, p) => p > 0.6 || j > 12,
      (j, r) => (j + r) % 4 === 0,
    ];
    for (const k of TARGETS) {
      const prize = prizeFor(k);
      for (const stop of rules) {
        const memo = new Map<number, number>();
        // Expected final payout from a state, following `stop` exactly.
        const value = (j: number, r: number): number => {
          if (r >= k) return prize;
          if (outOfReach(k, j, r)) return 0;
          const key = j * 1000 + r;
          const hit = memo.get(key);
          if (hit !== undefined) return hit;
          const p = winChance(k, j, r);
          const q = recordChance(j + 1);
          const v = j > 0 && stop(j, r, p) ? prize * p : q * value(j + 1, r + 1) + (1 - q) * value(j + 1, r);
          memo.set(key, v);
          return v;
        };
        expect(value(0, 0)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('simulated RTP matches the manifest under sampled stopping rules', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
