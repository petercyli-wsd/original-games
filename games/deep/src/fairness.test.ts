// Fairness audit: can any way of playing Deep beat the RTP?
//
// The depth limit and key count are fixed when the bet is placed (the chips
// are disabled while live), and pay prize = RTP / h(K, H). In a round the only
// decision is when to stop. So the question is whether V = prize · P(win | tree)
// is a martingale under the real draw: a key at x = rng.next() inserted by
// `insert`, busting when it sits deeper than H, with the "nothing can bust"
// shortcut paying the full prize, exactly as Game.tsx's drop() does it.
//
// The next key's landing point is continuous, so E[V after] is an integral over
// [0, 1]. Within one gap, V after a key landing at a fraction u of the gap is a
// polynomial in u of degree ≤ m (the keys still to come after it; see math.ts),
// and 0 over red gaps. A 16-point Gauss–Legendre rule per gap integrates any
// polynomial of degree ≤ 31 exactly, so the martingale check below is exact
// (to rounding). The bust chance itself (the red length) is also checked
// against the real draw by Monte Carlo.
//
// Strategies, per eval config, on the real draw (Game.tsx's drop logic):
//   (a) the tester's: drop only while the next key is ≥ 80% safe (red ≤ 20%),
//       else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the end;
//   (d) "free dots": drop while the next key cannot bust (no red at all) and
//       cash out the moment any red appears. Red-free drops are the obvious
//       candidate for a free option: they never bust but still move V.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  KEY_CHOICES,
  LIMITS,
  RTP,
  bustChance,
  emptyTree,
  heightAtMost,
  insert,
  prizeFor,
  sure,
  winChance,
  type Limit,
  type Tree,
} from './math';

/** Rounds per Monte Carlo run. The audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);

/** 16-point Gauss–Legendre nodes and weights on [0, 1]. */
const GL = (() => {
  const n = 16;
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    nodes.push((1 - x) / 2);
    weights.push(1 / ((1 - x * x) * dp * dp));
  }
  return { nodes, weights };
})();

interface Live {
  tree: Tree;
  keys: number;
  limit: number;
}

/** V after the next key lands at x, exactly as Game.tsx's drop() settles it. */
function valueAfter({ tree, keys, limit }: Live, x: number): number {
  const prize = prizeFor(keys, limit);
  const { tree: next, key } = insert(tree, x);
  if (key.depth > limit) return 0;
  const left = keys - next.keys.length;
  if (left === 0 || sure(next.gaps, left, limit)) return prize;
  return prize * winChance(next.gaps, left, limit);
}

/** V at a checkpoint (Game.tsx: round.cash). */
const valueNow = ({ tree, keys, limit }: Live) => prizeFor(keys, limit) * winChance(tree.gaps, keys - tree.keys.length, limit);

/** E[V after the next key], integrated exactly gap by gap. */
function expectedAfter(s: Live): number {
  let total = 0;
  for (const g of s.tree.gaps) {
    const L = g.hi - g.lo;
    if (L <= 0) continue;
    let part = 0;
    for (let i = 0; i < GL.nodes.length; i++) part += GL.weights[i] * valueAfter(s, g.lo + L * GL.nodes[i]);
    total += L * part;
  }
  return total;
}

type Stop = (s: Live, cash: () => number) => boolean;

/** One round exactly as Game.tsx plays it (first key with the bet, sure trees auto-play to the prize). */
function playRound(keys: number, limit: number, stop: Stop, rng: Rng): number {
  const prize = prizeFor(keys, limit);
  let tree = emptyTree();
  for (;;) {
    const { tree: next, key } = insert(tree, rng.next());
    if (key.depth > limit) return 0;
    tree = next;
    const left = keys - tree.keys.length;
    if (left === 0 || sure(tree.gaps, left, limit)) return prize;
    const s = { tree, keys, limit };
    const cash = () => prize * winChance(tree.gaps, left, limit);
    if (stop(s, cash)) return cash();
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) tester: drop while ≥ 80% safe', stop: (s) => bustChance(s.tree.gaps, s.limit) > 0.2 },
  { name: '(b) take any profit', stop: (_s, cash) => cash() > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) free dots: drop only while no red', stop: (s) => bustChance(s.tree.gaps, s.limit) > 0 },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const combos = LIMITS.flatMap((limit) => KEY_CHOICES[limit].map((keys) => ({ limit, keys })));

describe('Deep fairness', () => {
  it('Gauss–Legendre rule integrates polynomials of degree 31 exactly', () => {
    for (const d of [0, 5, 19, 31]) {
      const approx = GL.nodes.reduce((a, x, i) => a + GL.weights[i] * x ** d, 0);
      expect(approx).toBeCloseTo(1 / (d + 1), 13);
    }
  });

  it('the bet itself is fair: E[V after the first key] = RTP for every offered setting', () => {
    for (const { limit, keys } of combos) {
      const s = { tree: emptyTree(), keys, limit };
      expect(valueNow(s)).toBeCloseTo(RTP, 12);
      expect(prizeFor(keys, limit) * heightAtMost(keys, limit)).toBeCloseTo(RTP, 12);
      expect(Math.abs(expectedAfter(s) - RTP)).toBeLessThan(1e-9);
    }
  });

  it('martingale: at 40+ reached trees, E[V after the next key] = V now (exact integral)', () => {
    const rng = createRng(seededSource(7301));
    let checked = 0;
    let nearEnd = 0;
    let red = 0;
    for (let round = 0; round < 2000 && (checked < 40 || nearEnd < 8 || red < 15); round++) {
      const { limit, keys } = combos[rng.int(combos.length)];
      let tree = emptyTree();
      for (;;) {
        const { tree: next, key } = insert(tree, rng.next());
        if (key.depth > limit) break;
        tree = next;
        const left = keys - tree.keys.length;
        if (left === 0 || sure(tree.gaps, left, limit)) break;
        // Test some checkpoints of each round, more of them late in the round.
        if (rng.next() < 0.25 || left <= 2) {
          const s = { tree, keys, limit };
          const v = valueNow(s);
          expect(Math.abs(expectedAfter(s) - v)).toBeLessThan(1e-9 * prizeFor(keys, limit));
          checked++;
          if (left <= 2) nearEnd++;
          if (bustChance(tree.gaps, limit) > 0) red++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
    expect(nearEnd).toBeGreaterThanOrEqual(8);
    expect(red).toBeGreaterThanOrEqual(15);
  });

  it('the red length is the real bust chance (100k draws through insert, within 4 SE)', () => {
    const rng = createRng(seededSource(7302));
    let tested = 0;
    while (tested < 6) {
      const limit = 3 as Limit;
      let tree = emptyTree();
      for (let i = 0; i < 6; i++) {
        const { tree: next, key } = insert(tree, rng.next());
        if (key.depth > limit) break;
        tree = next;
      }
      const q = bustChance(tree.gaps, limit);
      if (q === 0) continue;
      const N = 100_000;
      let hits = 0;
      for (let i = 0; i < N; i++) if (insert(tree, rng.next()).key.depth > limit) hits++;
      const se = Math.sqrt((q * (1 - q)) / N);
      expect(Math.abs(hits / N - q)).toBeLessThan(4 * se);
      tested++;
    }
  });

  it('a "sure" tree really cannot bust: the auto-played keys always fit', () => {
    const rng = createRng(seededSource(7303));
    let seen = 0;
    for (let round = 0; round < 4000; round++) {
      const { limit, keys } = combos[rng.int(combos.length)];
      let tree = emptyTree();
      for (;;) {
        const { tree: next, key } = insert(tree, rng.next());
        if (key.depth > limit) break;
        tree = next;
        const left = keys - tree.keys.length;
        if (left === 0) break;
        if (sure(tree.gaps, left, limit)) {
          seen++;
          expect(winChance(tree.gaps, left, limit)).toBe(1);
          let t = tree;
          for (let i = 0; i < left; i++) {
            const r = insert(t, rng.next());
            expect(r.key.depth).toBeLessThanOrEqual(limit);
            t = r.tree;
          }
          break;
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it(`strategies on the real draw, every eval config (${ROUNDS} rounds each, within 4 SE)`, () => {
    const rows: string[] = [];
    let seed = 7400;
    for (const cfg of evalSpec.configs) {
      const { limit, keys } = cfg.params as { limit: Limit; keys: number };
      for (const { name, stop } of STRATEGIES) {
        const r = mc((rng) => playRound(keys, limit, stop, rng), ROUNDS, seed++);
        rows.push(`${cfg.label} | ${name} | ${(100 * r.mean).toFixed(3)}% ± ${(100 * r.se).toFixed(3)}%`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
