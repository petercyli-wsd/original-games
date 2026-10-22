import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  NODES,
  RTP,
  SIDES,
  SPARES,
  budgetOf,
  components,
  connectChance,
  crossPairs,
  decided,
  mergeChance,
  offered,
  openPairList,
  pairs,
  partsOf,
  prizeFor,
  singletons,
  startChance,
  winChance,
  type Edge,
} from './math';

const rng = createRng(seededSource(23));

const connected = (n: number, edges: readonly Edge[]) => new Set(components(n, edges)).size === 1;

/** A random reachable live state: n, budget E and the first few edges of the real process. */
function randomState() {
  for (;;) {
    const n = NODES[rng.int(NODES.length)];
    const spares = SPARES.filter((x) => offered(n, x));
    const E = budgetOf(n, spares[rng.int(spares.length)]);
    const edges: Edge[] = [];
    const steps = 1 + rng.int(E - 1);
    for (let i = 0; i < steps; i++) {
      const open = openPairList(n, edges);
      const p = open[rng.int(open.length)];
      edges.push([p.a, p.b]);
    }
    const parts = partsOf(n, edges);
    if (!decided(parts, edges.length, E)) return { n, E, edges, parts };
  }
}

describe('Connect maths', () => {
  it('Cayley: with a budget of n − 1 edges the chance is n^(n−2) / C(C(n,2), n−1)', () => {
    for (const n of NODES) {
      let choose = 1;
      for (let i = 0; i < n - 1; i++) choose = (choose * (pairs(n) - i)) / (i + 1);
      expect(startChance('connect', n, 0)).toBeCloseTo(n ** (n - 2) / choose, 12);
    }
  });

  it('matches an exact count of connected graphs on 6 nodes, for every budget', () => {
    const n = 6;
    const all: Edge[] = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) all.push([a, b]);
    const conn = new Array(all.length + 1).fill(0);
    const total = new Array(all.length + 1).fill(0);
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const edges = all.filter((_, i) => mask & (1 << i));
      total[edges.length]++;
      if (connected(n, edges)) conn[edges.length]++;
    }
    for (let E = n - 1; E <= all.length; E++) expect(connectChance(singletons(n), 0, E)).toBeCloseTo(conn[E] / total[E], 12);
  });

  it('the raw process (random edge order) connects as often as the DP says', () => {
    for (const [n, spare] of [
      [6, 0],
      [8, 1],
      [8, 4],
      [10, 2],
      [10, 10],
    ] as const) {
      const E = budgetOf(n, spare);
      const all: Edge[] = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) all.push([a, b]);
      const rounds = 12_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (connected(n, rng.shuffle(all).slice(0, E))) wins++;
      const p = startChance('connect', n, spare);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('each edge is a fair bet: the cash-out now is the average over every open pair', () => {
    for (let t = 0; t < 300; t++) {
      const { n, E, edges, parts } = randomState();
      for (const side of SIDES) {
        const now = winChance(side, parts, edges.length, E);
        const open = openPairList(n, edges);
        let avg = 0;
        for (const { a, b } of open) avg += winChance(side, partsOf(n, [...edges, [a, b]]), edges.length + 1, E);
        expect(avg / open.length).toBeCloseTo(now, 12);
      }
    }
  });

  it('the green cells on the strip are exactly the open pairs that join two groups', () => {
    for (let t = 0; t < 300; t++) {
      const { n, edges, parts } = randomState();
      const open = openPairList(n, edges);
      const comp = components(n, edges);
      const cross = open.filter((p) => comp[p.a] !== comp[p.b]);
      // Drawn: the cross cells come first and are marked; the rest join a group to itself.
      expect(open.slice(0, cross.length).every((p) => p.cross)).toBe(true);
      expect(open.slice(cross.length).every((p) => !p.cross)).toBe(true);
      expect(open.length).toBe(pairs(n) - edges.length);
      expect(cross.length).toBe(crossPairs(parts));
      expect(cross.length / open.length).toBeCloseTo(mergeChance(parts, edges.length), 14);
      // With two groups left, every green cell connects the graph: their share is the swing chance.
      if (parts.length === 2) {
        const joins = open.filter((p) => connected(n, [...edges, [p.a, p.b]])).length;
        expect(joins).toBe(cross.length);
      }
    }
  });

  it('the round ends exactly when the result is settled', () => {
    for (let t = 0; t < 400; t++) {
      const { E, edges, parts } = randomState();
      const p = connectChance(parts, edges.length, E);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    // Settled states give exact 0 or 1.
    expect(connectChance([5, 1], 10, 10)).toBe(0); // budget spent, still split
    expect(connectChance([3, 3], 6, 8)).toBe(1); // two triangles: the next edge must join them
    expect(connectChance([4, 1, 1], 3, 4)).toBe(0); // two merges needed, one edge left
  });

  it('every prize on the menu is honest and below the max multiplier', () => {
    for (const n of NODES) {
      for (const spare of SPARES.filter((x) => offered(n, x))) {
        for (const side of SIDES) {
          const p = startChance(side, n, spare);
          expect(p).toBeGreaterThanOrEqual(0.01);
          expect(prizeFor(side, n, spare) * p).toBeCloseTo(RTP, 12);
          expect(prizeFor(side, n, spare)).toBeLessThanOrEqual(MAX_MULTIPLIER);
        }
      }
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(99);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
