import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MIN_START_CHANCE,
  RTP,
  SIZES,
  allSets,
  chainFactors,
  decide,
  grid,
  initialState,
  marginal,
  prizeFor,
  quickPicks,
  resolution,
  startChance,
  treeCount,
  winChance,
  type Pick,
  type Size,
  type TreeState,
} from './math';

const rng = createRng(seededSource(11));

/** Exact P(picks as wanted | revealed) from integer spanning-tree counts. */
function exactChance(st: TreeState, picks: readonly Pick[]): number {
  const ins = st.status.flatMap((s, i) => (s === 'in' ? [i] : []));
  const outs = st.status.flatMap((s, i) => (s === 'out' ? [i] : []));
  const pin = picks.filter((p) => p.want === 'in' && st.status[p.edge] === null).map((p) => p.edge);
  const pout = picks.filter((p) => p.want === 'out' && st.status[p.edge] === null).map((p) => p.edge);
  if (picks.some((p) => st.status[p.edge] !== null && st.status[p.edge] !== p.want)) return 0;
  const all = treeCount(st.size, ins, outs);
  return Number(treeCount(st.size, [...ins, ...pin], [...outs, ...pout])) / Number(all);
}

/** A reachable state: the sweep has run k edges with the true conditional chances. */
function reachable(size: Size, k: number, r: Rng = rng): TreeState {
  let st = initialState(size);
  for (let i = 0; i < k; i++) st = decide(st, r.next() < marginal(st, st.next));
  return st;
}

/** Wilson's algorithm (loop-erased random walks): an independent exact UST sampler. */
function wilson(size: Size, r: Rng): Set<number> {
  const g = grid(size);
  const inTree = new Array<boolean>(g.n).fill(false);
  const next = new Array<number>(g.n).fill(-1);
  const via = new Array<number>(g.n).fill(-1);
  inTree[r.int(g.n)] = true;
  const edges = new Set<number>();
  for (let s = 0; s < g.n; s++) {
    let v = s;
    while (!inTree[v]) {
      const k = r.int(g.adj[v].length / 2);
      next[v] = g.adj[v][2 * k];
      via[v] = g.adj[v][2 * k + 1];
      v = next[v];
    }
    for (v = s; !inTree[v]; v = next[v]) {
      inTree[v] = true;
      edges.add(via[v]);
    }
  }
  return edges;
}

describe('Spanning maths', () => {
  it('matrix-tree counts match the known grid values', () => {
    expect(treeCount('3x3', [])).toBe(192n);
    expect(treeCount('3x4', [])).toBe(2415n);
    expect(treeCount('4x4', [])).toBe(100352n);
    expect(treeCount('4x5', [])).toBe(4140081n);
  });

  it('Kirchhoff: each edge width (marginal) equals τ(G/e)/τ(G), and they sum to n − 1', () => {
    for (const size of SIZES) {
      const st = initialState(size);
      const g = grid(size);
      let sum = 0;
      g.edges.forEach((_, e) => {
        const m = marginal(st, e);
        sum += m;
        expect(m).toBeCloseTo(Number(treeCount(size, [e])) / Number(treeCount(size, [])), 12);
      });
      expect(sum).toBeCloseTo(g.n - 1, 10);
    }
  });

  it('transfer-current determinants equal exact tree counts at random reachable states', () => {
    for (const size of SIZES) {
      const E = grid(size).edges.length;
      for (let trial = 0; trial < 40; trial++) {
        const st = reachable(size, rng.int(E));
        const picks = quickPicks(size, 1 + rng.int(3), 'random', rng);
        expect(Math.abs(winChance(st, picks) - exactChance(st, picks))).toBeLessThan(1e-9);
        for (let e = st.next; e < E; e++) expect(Math.abs(marginal(st, e) - exactChance(st, [{ edge: e, want: 'in' }]))).toBeLessThan(1e-9);
        const r = resolution(st, picks);
        const exact = exactChance(st, picks);
        if (r) expect(exact).toBe(r === 'win' ? 1 : 0);
        else expect(exact > 0 && exact < 1).toBe(true);
      }
    }
  });

  it('the starting chance matches an independent UST simulation (Wilson’s algorithm)', () => {
    const rounds = 20000;
    for (const size of ['3x4', '4x5'] as const) {
      for (let s = 0; s < 3; s++) {
        const picks = quickPicks(size, 1 + s, 'random', rng);
        let wins = 0;
        for (let i = 0; i < rounds; i++) {
          const t = wilson(size, rng);
          if (picks.every((p) => t.has(p.edge) === (p.want === 'in'))) wins++;
        }
        const p = startChance(size, picks);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('the edge-by-edge sweep samples every spanning tree of the 3×3 grid equally often', () => {
    const rounds = 9600;
    const counts = new Map<string, number>();
    for (let i = 0; i < rounds; i++) {
      const st = reachable('3x3', grid('3x3').edges.length);
      const ins = st.status.flatMap((s, e) => (s === 'in' ? [e] : []));
      expect(ins.length).toBe(8);
      expect(treeCount('3x3', ins)).toBe(1n); // acyclic with 8 edges on 9 dots: a spanning tree
      const key = ins.join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(192);
    const expected = rounds / 192;
    let chi2 = 0;
    for (const c of counts.values()) chi2 += (c - expected) ** 2 / expected;
    expect(chi2).toBeLessThan(191 + 5 * Math.sqrt(2 * 191));
  });

  it('each sweep is a fair bet: E[cash-out after the step] = cash-out now', () => {
    // Enumerate every outcome of one step exactly, weighted by its chance.
    const expectAfter = (st: TreeState, picks: readonly Pick[], layer: number): number => {
      const g = grid(st.size);
      if (st.next >= g.edges.length || g.edges[st.next].layer !== layer || resolution(st, picks)) return winChance(st, picks);
      const p = marginal(st, st.next);
      return (p > 0 ? p * expectAfter(decide(st, true), picks, layer) : 0) + (p < 1 ? (1 - p) * expectAfter(decide(st, false), picks, layer) : 0);
    };
    for (const size of SIZES) {
      const E = grid(size).edges.length;
      for (let trial = 0; trial < 25; trial++) {
        const picks = quickPicks(size, 1 + rng.int(3), 'random', rng);
        let st = reachable(size, rng.int(E - 1));
        // Line up on a layer boundary, as a checkpoint would be.
        while (st.next > 0 && st.next < E && grid(size).edges[st.next].layer === grid(size).edges[st.next - 1].layer) st = decide(st, rng.next() < marginal(st, st.next));
        if (st.next >= E || resolution(st, picks)) continue;
        const prize = prizeFor(size, picks);
        expect(prize * expectAfter(st, picks, grid(size).edges[st.next].layer)).toBeCloseTo(prize * winChance(st, picks), 9);
      }
    }
  });

  it('the funnel on screen multiplies out to the win chance', () => {
    for (const size of SIZES) {
      for (let trial = 0; trial < 30; trial++) {
        const st = reachable(size, rng.int(grid(size).edges.length));
        const picks = quickPicks(size, 1 + rng.int(3), 'random', rng);
        const f = chainFactors(st, picks);
        expect(f.reduce((a, b) => a * b, 1)).toBeCloseTo(winChance(st, picks), 10);
      }
    }
  });

  it('choices are EV-neutral and the max multiplier is honest', () => {
    let min = 1;
    for (const size of SIZES) {
      for (const { p } of allSets(size)) {
        min = Math.min(min, p);
        expect(p).toBeGreaterThan(0);
      }
      // Any choice starts at exactly RTP.
      const picks = quickPicks(size, 3, 'long', rng);
      expect(prizeFor(size, picks) * winChance(initialState(size), picks)).toBeCloseTo(RTP, 12);
    }
    expect(min).toBeCloseTo(MIN_START_CHANCE, 12);
    expect(RTP / MIN_START_CHANCE).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 20_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
