import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  LIMITS,
  LOADS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  afterSafeKey,
  blockCounts,
  clusters,
  emptyTable,
  fillChance,
  fillChanceFrom,
  fillCount,
  insert,
  keysFor,
  maxMultiplier,
  probeDistance,
  redCount,
  redSlots,
  type Table,
} from './math';

const rng = createRng(seededSource(11));

/** Plays n safe keys from an empty table (re-hashing overflows), giving a random reachable state. */
function reachable(m: number, n: number, limit: number, r: Rng): boolean[] {
  let table = emptyTable(m);
  for (let k = 0, tries = 0; k < n && tries < 500; tries++) {
    const res = insert(table, r.int(m), limit);
    if (!res.safe) continue;
    table = res.table;
    k++;
  }
  return table;
}

/** Brute force: enumerate every hash sequence and count those that store all keys within the limit. */
function bruteCount(m: number, K: number, limit: number): number {
  let good = 0;
  const seq = new Array<number>(K).fill(0);
  for (let idx = 0; idx < m ** K; idx++) {
    let x = idx;
    for (let i = 0; i < K; i++) {
      seq[i] = x % m;
      x = Math.floor(x / m);
    }
    let table: Table = emptyTable(m);
    let ok = true;
    for (const h of seq) {
      const res = insert(table, h, limit);
      if (!res.safe) {
        ok = false;
        break;
      }
      table = res.table;
    }
    if (ok) good++;
  }
  return good;
}

describe('Probe maths', () => {
  it('with no limit the block counts are parking functions (c+1)^(c-1) and every sequence fits', () => {
    const f = blockCounts(99, 10);
    for (let c = 1; c <= 10; c++) expect(f[c]).toBe(BigInt(c + 1) ** BigInt(c - 1));
    for (const m of SIZES) expect(fillCount(m, m - 4, 99)).toBe(BigInt(m) ** BigInt(m - 4));
  });

  it('the closed form equals exact enumeration of every hash sequence', () => {
    for (const [m, K] of [
      [6, 3],
      [6, 4],
      [6, 5],
      [7, 5],
      [8, 5],
    ]) {
      for (const limit of [0, 1, 2, 3]) expect(Number(fillCount(m, K, limit))).toBe(bruteCount(m, K, limit));
    }
  });

  it('the closed form matches a direct simulation of linear probing', () => {
    for (const m of SIZES) {
      for (const limit of [1, 3]) {
        const K = keysFor(m, 0.625);
        const rounds = 20_000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const table = new Array<boolean>(m).fill(false);
          let ok = true;
          for (let k = 0; k < K && ok; k++) {
            const h = rng.int(m);
            let d = 0;
            while (table[(h + d) % m]) d++;
            if (d > limit) ok = false;
            else table[(h + d) % m] = true;
          }
          if (ok) wins++;
        }
        const p = fillChance(m, K, limit);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('the red slots are exactly the homes that overflow, and their count is Σ max(0, c − P)', () => {
    for (const m of SIZES) {
      for (const limit of LIMITS) {
        for (let trial = 0; trial < 25; trial++) {
          const table = reachable(m, 1 + rng.int(Math.round(m * 0.75)), limit, rng);
          const red = redSlots(table, limit);
          let busting = 0;
          for (let h = 0; h < m; h++) {
            const res = insert(table, h, limit);
            expect(res.safe).toBe(!red[h]);
            // A red slot is one where h and the next P slots are all full.
            const allFull = Array.from({ length: limit + 1 }, (_, i) => table[(h + i) % m]).every(Boolean);
            expect(red[h]).toBe(allFull);
            if (!res.safe) busting++;
            else expect(res.hops).toBe(probeDistance(table, h));
          }
          expect(busting).toBe(redCount(table, limit));
          const fromClusters = clusters(table).reduce((s, c) => s + Math.max(0, c.length - limit), 0);
          expect(redCount(table, limit)).toBe(fromClusters);
        }
      }
    }
  });

  it('each key is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const m of SIZES) {
      for (const limit of LIMITS) {
        for (let trial = 0; trial < 10; trial++) {
          const table = reachable(m, 2 + rng.int(m / 2), limit, rng);
          const red = redCount(table, limit);
          const before = RTP * (1 + rng.next() * 5);
          let expected = 0;
          for (let h = 0; h < m; h++) {
            if (insert(table, h, limit).safe) expected += afterSafeKey(before, red, m) / m;
          }
          expect(expected).toBeCloseTo(before, 10);
        }
      }
    }
  });

  it('the live fill chance starts at the headline and is itself a martingale', () => {
    for (const m of SIZES) {
      for (const limit of LIMITS) {
        for (const load of LOADS) {
          const K = keysFor(m, load);
          expect(fillChanceFrom(emptyTable(m), K, limit)).toBeCloseTo(fillChance(m, K, limit), 12);
        }
        for (let trial = 0; trial < 4; trial++) {
          const K = keysFor(m, LOADS[rng.int(LOADS.length)]);
          const table = reachable(m, 1 + rng.int(K - 1), limit, rng);
          const now = fillChanceFrom(table, K, limit);
          let next = 0;
          for (let h = 0; h < m; h++) {
            const res = insert(table, h, limit);
            if (res.safe) next += fillChanceFrom(res.table, K, limit) / m;
          }
          expect(next).toBeCloseTo(now, 10);
        }
      }
    }
  });

  it('the live fill chance matches simulation from a mid-round table', () => {
    for (const [m, limit] of [
      [24, 2],
      [32, 1],
    ] as const) {
      const K = keysFor(m, 0.75);
      const table = reachable(m, Math.round(K / 2), limit, rng);
      const p = fillChanceFrom(table, K, limit);
      const rounds = 20_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let t: Table = table;
        let ok = true;
        for (let k = K - t.filter(Boolean).length; k > 0 && ok; k--) {
          const res = insert(t, rng.int(m), limit);
          ok = res.safe;
          t = res.table;
        }
        if (ok) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('maxMultiplier is reached by one growing cluster and bounds every setting', () => {
    for (const m of SIZES) {
      for (const limit of LIMITS) {
        for (const load of LOADS) {
          const K = keysFor(m, load);
          let table: Table = emptyTable(m);
          let cash = RTP;
          for (let k = 0; k < K; k++) {
            const red = redCount(table, limit);
            expect(red).toBeLessThanOrEqual(Math.max(0, k - limit));
            const res = insert(table, k, limit);
            expect(res.safe).toBe(true);
            cash = afterSafeKey(cash, red, m);
            table = res.table;
          }
          expect(cash).toBeCloseTo(maxMultiplier(m, K, limit), 6);
          expect(cash).toBeLessThanOrEqual(MAX_MULTIPLIER * (1 + 1e-12));
        }
      }
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
