import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DEPTHS,
  GRID,
  MAX_MULTIPLIER,
  PRESETS,
  RTP,
  clampWin,
  countLit,
  inWindow,
  leavesBelow,
  nodeAt,
  prizeFor,
  rowIndex,
  tOf,
  treeRows,
  winChance,
  type Dir,
  type Win,
} from './math';

const rng = createRng(seededSource(13));
const randomPath = (len: number): Dir[] => Array.from({ length: len }, () => (rng.next() < 0.5 ? 'L' : 'R'));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Minkowski's ?(t) for a rational t = a/b in [0, 1], from its continued fraction. */
function minkowski(a: number, b: number): number {
  if (a === 0) return 0;
  if (a === b) return 1;
  const cf: number[] = [];
  let [x, y] = [b, a]; // t = a/b = [0; a1, a2, ...]
  while (y) {
    cf.push(Math.floor(x / y));
    [x, y] = [y, x % y];
  }
  let sum = 0;
  let s = 0;
  cf.forEach((ak, k) => {
    s += ak;
    sum += (k % 2 ? -1 : 1) * 2 ** (1 - s);
  });
  return sum;
}

describe('Mediant maths', () => {
  it('depth n of the Stern–Brocot tree holds 2ⁿ distinct reduced fractions, in increasing order', () => {
    for (const n of DEPTHS) {
      const row = treeRows(n)[n];
      expect(row.length).toBe(2 ** n);
      row.forEach((m, i) => {
        expect(gcd(m.p, m.q)).toBe(1);
        if (i) expect(m.p * row[i - 1].q).toBeGreaterThan(row[i - 1].p * m.q);
      });
    }
  });

  it('Minkowski: the share of depth-n endings below a shallower node v is exactly ?(v/(1+v))', () => {
    for (const n of DEPTHS) {
      const rows = treeRows(n);
      for (let d = 0; d < n; d++) {
        for (const v of rows[d]) {
          const below = rows[n].filter((m) => m.p * v.q < v.p * m.q).length;
          expect(below / 2 ** n).toBe(minkowski(v.p, v.p + v.q));
        }
      }
    }
    // So the window from ½ to 2 holds exactly half of the endings at every depth.
    for (const n of DEPTHS) expect(winChance([], n, PRESETS[0])).toBe(0.5);
  });

  it('the exact chance matches a direct simulation of the raw mediant walk', () => {
    for (const w of PRESETS) {
      for (const n of DEPTHS) {
        const p = winChance([], n, w);
        const rounds = 6000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          // Raw process: bounds a/b < x < c/d, step to the mediant.
          let [a, b, c, d] = [0, 1, 1, 0];
          let [x, y] = [1, 1];
          for (let s = 0; s < n; s++) {
            if (rng.next() < 0.5) [c, d] = [x, y];
            else [a, b] = [x, y];
            [x, y] = [a + c, b + d];
          }
          const t = x / (x + y);
          if (t >= w.lo / GRID - 1e-12 && t <= w.hi / GRID + 1e-12) wins++;
        }
        expect(Math.abs(wins / rounds - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
      }
    }
  });

  it('each flip is a fair bet: P(now) = ½ P(after L) + ½ P(after R), so the cash-out is a martingale', () => {
    for (let trial = 0; trial < 400; trial++) {
      const n = DEPTHS[rng.int(DEPTHS.length)];
      const w = clampWin(rng.int(GRID + 1), rng.int(GRID + 1));
      if (countLit([], n, w).lit === 0) continue;
      const path = randomPath(rng.int(n));
      const prize = prizeFor(n, w);
      const now = prize * winChance(path, n, w);
      const next = 0.5 * prize * winChance([...path, 'L'], n, w) + 0.5 * prize * winChance([...path, 'R'], n, w);
      expect(next).toBeCloseTo(now, 9);
      expect(prize * winChance([], n, w)).toBeCloseTo(RTP, 12);
    }
  });

  it('the lit dots on the board are exactly the reachable endings in the window', () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = DEPTHS[rng.int(DEPTHS.length)];
      const w: Win = clampWin(rng.int(GRID + 1), rng.int(GRID + 1));
      const path = randomPath(rng.int(n + 1));
      const rows = treeRows(n);
      const at = rowIndex(path);
      // The board's rule: a leaf is reachable when its index lies under the current node.
      const reachable = rows[n].filter((_, i) => i >> (n - path.length) === at);
      // Every reachable ending is a full walk that starts with this path.
      for (const m of reachable) {
        const i = rows[n].indexOf(m);
        const full: Dir[] = Array.from({ length: n }, (_, b) => ((i >> (n - 1 - b)) & 1 ? 'R' : 'L'));
        expect(full.slice(0, path.length)).toEqual(path);
      }
      // Drawn positions (t on the line) inside the drawn column, away from the edges.
      let lit = 0;
      for (const m of reachable) {
        const t = tOf(m.p, m.q);
        const inside = inWindow(m.p, m.q, w);
        if (inside) lit++;
        if (Math.abs(t - w.lo / GRID) > 1e-9 && Math.abs(t - w.hi / GRID) > 1e-9) expect(inside).toBe(t > w.lo / GRID && t < w.hi / GRID);
      }
      const c = countLit(path, n, w);
      expect(c).toEqual({ lit, total: reachable.length });
      // The pruned count equals plain enumeration below the current node.
      expect(leavesBelow(nodeAt(path), n - path.length).filter((m) => inWindow(m.p, m.q, w)).length).toBe(lit);
    }
  });

  it('the largest prize is RTP × 1024 and nothing pays more', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 1024, 12);
    for (const w of PRESETS) for (const n of DEPTHS) if (countLit([], n, w).lit) expect(prizeFor(n, w)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
