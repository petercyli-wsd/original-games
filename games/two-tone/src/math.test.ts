import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  EDGES,
  NODES,
  RTP,
  addEdge,
  afterSafeEdge,
  bipartiteChance,
  bipartiteCounts,
  edgesAllowed,
  emptyGraph,
  fatalPairs,
  finishChance,
  isBipartite,
  isFatal,
  maxMultiplier,
  oddCycle,
  openPairs,
  pairCount,
  profile,
  reachChance,
  risk,
  type Graph,
  type Pair,
} from './math';

const rng = createRng(seededSource(11));

const OFFERED = NODES.flatMap((n) => EDGES.filter((e) => edgesAllowed(n, e)).map((e) => [n, e] as const));

/** A reachable live state: random safe edges, stopping at a random size (never saturated). */
function randomState(n: number, r: Rng, maxEdges = 12): Graph {
  let g = emptyGraph(n);
  const size = r.int(maxEdges + 1);
  while (g.edges.length < size) {
    const open = openPairs(g).filter(([u, v]) => !isFatal(g, u, v));
    if (open.length === 0) break;
    const [u, v] = open[r.int(open.length)];
    const next = addEdge(g, u, v);
    if (risk(next).q >= 1) break;
    g = next;
  }
  return g;
}

describe('Two-Tone maths', () => {
  it('the EGF square root counts bipartite graphs exactly (brute force over every graph, n ≤ 6)', () => {
    for (let n = 1; n <= 6; n++) {
      const N = pairCount(n);
      const all: Pair[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) all.push([i, j]);
      const counts = Array(N + 1).fill(0);
      for (let mask = 0; mask < 1 << N; mask++) {
        const edges = all.filter((_, k) => mask & (1 << k));
        if (isBipartite(n, edges)) counts[edges.length]++;
      }
      const B = bipartiteCounts(n);
      for (let m = 0; m <= N; m++) expect(Number(B[m] ?? 0n)).toBe(counts[m]);
    }
    // Totals: OEIS A033995, labelled bipartite graphs.
    const totals = [1, 1, 2, 7, 41, 376, 5177];
    totals.forEach((t, n) => expect(bipartiteCounts(n).reduce((a, b) => a + b, 0n)).toBe(BigInt(t)));
  });

  it('the profile DP agrees with the closed form B(n, E) / C(N, E) for every offered setting', () => {
    for (const [n, E] of OFFERED) expect(Math.abs(reachChance(n, E) - bipartiteChance(n, E))).toBeLessThan(1e-12);
    // Saturation (a complete bipartite graph before E) needs E ≥ n.
    for (const [n, E] of OFFERED) if (E < n) expect(finishChance(n, E)).toBeCloseTo(reachChance(n, E), 14);
  });

  it('the raw random graph process is bipartite after E edges as often as the formula says', () => {
    for (const [n, E] of OFFERED) {
      const rounds = 8_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const pairs = rng.shuffle(openPairs(emptyGraph(n))).slice(0, E);
        if (isBipartite(n, pairs)) wins++;
      }
      const p = bipartiteChance(n, E);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('playing the game to the end pays exactly as often as finishChance says (saturation included)', () => {
    for (const [n, E] of [[6, 6], [6, 8]] as const) {
      const rounds = 20_000;
      let paid = 0;
      for (let r = 0; r < rounds; r++) {
        const edges: Pair[] = [];
        let ok = true;
        while (ok && edges.length < E) {
          const open: Pair[] = [];
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (!edges.some(([a, b]) => a === i && b === j)) open.push([i, j]);
          // Saturated: every open pair would close an odd cycle (brute force).
          if (open.every((e) => !isBipartite(n, [...edges, e]))) break;
          edges.push(open[rng.int(open.length)]);
          ok = isBipartite(n, edges);
        }
        if (ok) paid++;
      }
      const p = finishChance(n, E);
      expect(Math.abs(paid / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('the fatal pairs drawn on the board are exactly the pairs that close an odd cycle', () => {
    for (const n of NODES) {
      for (let trial = 0; trial < 40; trial++) {
        const g = randomState(n, rng);
        expect(isBipartite(n, g.edges)).toBe(true);
        // Tones are a proper 2-colouring of every component.
        for (const [u, v] of g.edges) {
          expect(g.tone[u]).not.toBe(g.tone[v]);
          expect(g.comp[u]).toBe(g.comp[v]);
        }
        const open = openPairs(g);
        const brute = open.filter((e) => !isBipartite(n, [...g.edges, e])).map(String);
        const drawn = fatalPairs(g).map(String);
        expect(drawn).toEqual(brute);
        const { fatal, open: openCount, q } = risk(g);
        expect(openCount).toBe(open.length);
        expect(fatal).toBe(brute.length);
        expect(q).toBe(brute.length / open.length);
        // The closed count Σ C(a,2) + C(b,2) over tone classes.
        expect(profile(g).reduce((s, [a, b]) => s + (a * (a - 1)) / 2 + (b * (b - 1)) / 2, 0)).toBe(fatal);
        // A fatal pair's path plus the new edge is an odd cycle of real edges.
        for (const [u, v] of fatalPairs(g).slice(0, 3)) {
          const path = oddCycle(g, u, v);
          expect(path.length % 2).toBe(1);
          for (let k = 0; k + 1 < path.length; k++) {
            const [a, b] = [path[k], path[k + 1]].sort((x, y) => x - y);
            expect(g.edges.some(([x, y]) => x === a && y === b)).toBe(true);
          }
        }
      }
    }
  });

  it('each edge is a fair bet: E[cash-out after] = cash-out now, and the finish chance is a martingale', () => {
    for (const [n, E] of OFFERED) {
      for (let trial = 0; trial < 12; trial++) {
        const g = randomState(n, rng, E - 1);
        const { q } = risk(g);
        if (q >= 1) continue;
        const open = openPairs(g);
        const cash = RTP * (1 + rng.next() * 5);
        let after = 0;
        let finish = 0;
        for (const [u, v] of open) {
          if (isFatal(g, u, v)) continue;
          after += afterSafeEdge(cash, q) / open.length;
          const next = addEdge(g, u, v);
          finish += (next.edges.length >= E || risk(next).q >= 1 ? 1 : finishChance(n, E, next)) / open.length;
        }
        expect(Math.abs(after - cash)).toBeLessThan(1e-9 * cash);
        expect(Math.abs(finish - finishChance(n, E, g))).toBeLessThan(1e-12);
      }
    }
  });

  it('MAX_MULTIPLIER bounds every offered setting exactly', () => {
    const worst = Math.max(...OFFERED.map(([n, E]) => maxMultiplier(n, E)));
    expect(worst).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(worst).toBeGreaterThan(manifest.maxMultiplier * 0.99);
  });

  it('simulated RTP matches the manifest under every sampled strategy', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
