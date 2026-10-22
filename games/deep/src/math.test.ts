import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  KEY_CHOICES,
  LIMITS,
  RTP,
  bustChance,
  chanceIfLandsAt,
  emptyTree,
  fullSize,
  gapAt,
  heightAtMost,
  insert,
  landingProfile,
  prizeFor,
  seriesChance,
  sure,
  winChance,
  type Tree,
} from './math';

const rng = createRng(seededSource(11));

/** A plain pointer BST, independent of the gap bookkeeping: returns the depth each key lands at. */
class RefBst {
  private nodes: { x: number; l: number; r: number }[] = [];
  insert(x: number): number {
    if (this.nodes.length === 0) {
      this.nodes.push({ x, l: -1, r: -1 });
      return 0;
    }
    let i = 0;
    let d = 0;
    for (;;) {
      const n = this.nodes[i];
      const side = x < n.x ? 'l' : 'r';
      d++;
      if (n[side] < 0) {
        n[side] = this.nodes.length;
        this.nodes.push({ x, l: -1, r: -1 });
        return d;
      }
      i = n[side];
    }
  }
  /** Depth x would land at, without inserting it. */
  probe(x: number): number {
    if (this.nodes.length === 0) return 0;
    let i = 0;
    let d = 0;
    for (;;) {
      const n = this.nodes[i];
      const next = x < n.x ? n.l : n.r;
      d++;
      if (next < 0) return d;
      i = next;
    }
  }
}

/** A random live tree for the given settings: n keys, none below the limit. */
function randomLiveTree(limit: number, n: number): Tree {
  for (;;) {
    let t = emptyTree();
    let ok = true;
    while (ok && t.keys.length < n) {
      const r = insert(t, rng.next());
      ok = r.key.depth <= limit;
      t = r.tree;
    }
    if (ok) return t;
  }
}

/** Gauss–Legendre nodes and weights on [0, 1] (exact for polynomials of degree ≤ 2n − 1). */
function gaussLegendre(n: number): { x: number; w: number }[] {
  const out: { x: number; w: number }[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k];
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    out.push({ x: (1 - z) / 2, w: 1 / ((1 - z * z) * dp * dp) });
  }
  return out;
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
const binom = (n: number, k: number) => {
  let b = 1;
  for (let i = 1; i <= k; i++) b = (b * (n - k + i)) / i;
  return b;
};

describe('Deep maths', () => {
  it('h(n, c) matches exhaustive enumeration of insertion orders and the closed forms', () => {
    // Every permutation of n ≤ 8 keys, inserted in order: count heights exactly.
    for (let n = 1; n <= 8; n++) {
      const counts = new Map<number, number>();
      const perm = Array.from({ length: n }, (_, i) => i);
      const visit = (k: number) => {
        if (k === n) {
          const t = new RefBst();
          let h = 0;
          for (const v of perm) h = Math.max(h, t.insert(v));
          counts.set(h, (counts.get(h) ?? 0) + 1);
          return;
        }
        for (let i = k; i < n; i++) {
          [perm[k], perm[i]] = [perm[i], perm[k]];
          visit(k + 1);
          [perm[k], perm[i]] = [perm[i], perm[k]];
        }
      };
      visit(0);
      const total = factorial(n);
      for (let c = 0; c <= 8; c++) {
        let atMost = 0;
        for (const [h, cnt] of counts) if (h <= c) atMost += cnt;
        expect(heightAtMost(n, c)).toBeCloseTo(atMost / total, 13);
      }
    }
    // Closed forms: one shape too tall with c + 2 keys is a chain (2^(c+1) orders);
    // a perfect tree of height c has perfect(c) = C(2^(c+1) − 2, 2^c − 1) · perfect(c − 1)² orders.
    let perfect = 1;
    for (let c = 0; c <= 6; c++) {
      if (c > 0) perfect = binom(fullSize(c) - 1, fullSize(c - 1)) * perfect ** 2;
      expect(heightAtMost(c + 2, c)).toBeCloseTo(1 - 2 ** (c + 1) / factorial(c + 2), 13);
      const N = fullSize(c);
      const ratio = perfect / factorial(N);
      expect(Math.abs(heightAtMost(N, c) - ratio) / ratio).toBeLessThan(1e-9);
      expect(heightAtMost(N + 1, c)).toBe(0);
    }
  });

  it('the headline chance h(K, H) matches a direct simulation of random BSTs', () => {
    for (const H of LIMITS) {
      for (const K of [KEY_CHOICES[H][1], KEY_CHOICES[H][3]]) {
        const rounds = 12_000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const t = new RefBst();
          let h = 0;
          for (let i = 0; i < K && h <= H; i++) h = Math.max(h, t.insert(rng.next()));
          if (h <= H) wins++;
        }
        const p = heightAtMost(K, H);
        expect(seriesChance(emptyTree().gaps, K, H)).toBeCloseTo(p, 12);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('the live chance P(win | tree) matches simulating the rest of the round', () => {
    for (const [H, K, n] of [
      [3, 10, 4],
      [4, 12, 6],
      [5, 14, 7],
      [3, 8, 5],
    ] as const) {
      const t = randomLiveTree(H, n);
      const p = winChance(t.gaps, K - n, H);
      const rounds = 12_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const ref = new RefBst();
        for (const k of t.keys) ref.insert(k.x);
        let ok = true;
        for (let i = n; i < K && ok; i++) ok = ref.insert(rng.next()) <= H;
        if (ok) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('each key is a fair bet: E[cash-out after the key] = cash-out now (exact quadrature)', () => {
    const gl = gaussLegendre(16); // P(win | key at x) is a polynomial of degree < 20 within each gap
    for (const H of LIMITS) {
      for (const K of KEY_CHOICES[H]) {
        for (let trial = 0; trial < 3; trial++) {
          const n = 1 + rng.int(K - 1);
          const t = randomLiveTree(H, n);
          const now = prizeFor(K, H) * winChance(t.gaps, K - n, H);
          let after = 0;
          for (const g of t.gaps) {
            const L = g.hi - g.lo;
            for (const { x, w } of gl) after += w * L * prizeFor(K, H) * chanceIfLandsAt(t, g.lo + x * L, K, H);
          }
          expect(Math.abs(after - now)).toBeLessThan(1e-9 * Math.max(1, now));
        }
      }
    }
  });

  it('the drawn ledges and red stretch are exactly where the next key lands and busts', () => {
    for (const H of LIMITS) {
      for (let trial = 0; trial < 8; trial++) {
        const n = 1 + rng.int(KEY_CHOICES[H][4] - 1);
        const t = randomLiveTree(H, n);
        const ref = new RefBst();
        for (const k of t.keys) ref.insert(k.x);
        // Parents and depths agree with real BST insertion.
        t.keys.forEach((k, i) => {
          if (k.parent >= 0) {
            expect(t.keys[k.parent].depth).toBe(k.depth - 1);
            expect(t.keys[k.parent].x).not.toBe(k.x);
          } else expect(i).toBe(0);
        });
        // Sweep the line: each point's ledge depth is the depth a key there gets.
        const N = 2000;
        let busting = 0;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N;
          const d = ref.probe(x);
          expect(t.gaps[gapAt(t.gaps, x)].depth).toBe(d);
          if (d > H) busting++;
        }
        expect(Math.abs(busting / N - bustChance(t.gaps, H))).toBeLessThan((2 * (n + 1)) / N);
        // The arches drawn over the line are the exact landing chances.
        const left = KEY_CHOICES[H][4] - n;
        if (left < 1) continue;
        for (const arch of landingProfile(t.gaps, left, H, 40)) {
          for (const { x, p } of arch.filter((_, j) => j % 3 === 1)) {
            const inGap = gapAt(t.gaps, x);
            if (t.gaps[inGap].lo === x) continue; // an arch end sits on a key: the tie goes right
            expect(p).toBeCloseTo(chanceIfLandsAt(t, x, KEY_CHOICES[H][4], H), 10);
          }
        }
      }
    }
  });

  it('no dead ends, and the "nothing can bust" shortcut is exact', () => {
    for (const H of LIMITS) {
      for (let trial = 0; trial < 40; trial++) {
        const K = KEY_CHOICES[H][rng.int(5)];
        const n = 1 + rng.int(K - 1);
        const t = randomLiveTree(H, n);
        // Room within the limit is always the perfect tree minus the keys placed.
        const room = t.gaps.reduce((s, g) => s + (g.depth <= H ? fullSize(H - g.depth) : 0), 0);
        expect(room).toBe(fullSize(H) - n);
        const p = seriesChance(t.gaps, K - n, H);
        expect(p).toBeGreaterThan(0);
        if (sure(t.gaps, K - n, H)) expect(p).toBeCloseTo(1, 12);
        else expect(p).toBeLessThan(1 - 1e-12);
      }
    }
  });

  it('the start is worth RTP and the prize bounds every cash-out', () => {
    for (const H of LIMITS) {
      for (const K of KEY_CHOICES[H]) {
        expect(prizeFor(K, H) * winChance(emptyTree().gaps, K, H)).toBeCloseTo(RTP, 12);
        expect(prizeFor(K, H)).toBeLessThanOrEqual(manifest.maxMultiplier);
      }
    }
  });

  it('simulated RTP matches the manifest under mixed strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
