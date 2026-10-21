// Circuit: power has to get from S to T across a network whose wires each hold
// independently with probability Q. R0 = P(S–T connected) for the topology and
// the prize is RTP / R0. Wires are revealed one at a time; after each reveal
// R_t = P(connected | revealed wires) is a martingale, and the cash-out is
// prize × R_t, so every stopping strategy is worth exactly RTP.
//
// Networks are small (≤ 16 wires) so everything is exact: R is a sum over the
// 2^u states of the u unrevealed wires, using a precomputed connectivity table.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** Chance each wire holds. A coin flip keeps the odds easy to read (and dyadic, so exact in floats). */
export const Q = 0.5;

/** Node 0 is the source, node 1 the target, in every topology. */
export const S = 0;
export const T = 1;

export type TopologyId = 'parallel' | 'bridge' | 'ladder' | 'series';

export interface Topology {
  id: TopologyId;
  name: string;
  blurb: string;
  volatility: Volatility;
  /** Node positions in a 640 × 360 board. */
  nodes: [number, number][];
  /** Wires as [from, to] node pairs. */
  edges: [number, number][];
}

const W = 640;
const MID = 180;

// Four redundant two-wire routes: any one of them is enough.
function parallel(): Topology {
  const ys = [42, 134, 226, 318];
  return {
    id: 'parallel',
    name: 'Parallel',
    blurb: 'Four redundant routes. Any one gets through.',
    volatility: 'low',
    nodes: [[56, MID], [W - 56, MID], ...ys.map((y): [number, number] => [W / 2, y])],
    edges: ys.flatMap((_, i): [number, number][] => [[S, i + 2], [i + 2, T]]),
  };
}

// The Wheatstone bridge: two routes with a cross-link between them.
function bridge(): Topology {
  return {
    id: 'bridge',
    name: 'Bridge',
    blurb: 'Two routes and a cross-link. The classic.',
    volatility: 'medium',
    nodes: [[56, MID], [W - 56, MID], [W / 2, 48], [W / 2, 312]],
    edges: [[S, 2], [S, 3], [2, 3], [2, T], [3, T]],
  };
}

// Two rails joined by four rungs: lots of ways round a break, but long.
function ladder(): Topology {
  const xs = [170, 270, 370, 470];
  const top = (i: number) => 2 + i;
  const bot = (i: number) => 6 + i;
  const edges: [number, number][] = [[S, top(0)], [S, bot(0)]];
  for (let i = 0; i < 3; i++) edges.push([top(i), top(i + 1)], [bot(i), bot(i + 1)]);
  edges.push([top(3), T], [bot(3), T]);
  for (let i = 0; i < 4; i++) edges.push([top(i), bot(i)]);
  return {
    id: 'ladder',
    name: 'Ladder',
    blurb: 'Two rails, four rungs. Long, but it can reroute.',
    volatility: 'high',
    nodes: [
      [50, MID],
      [W - 50, MID],
      ...xs.map((x): [number, number] => [x, 82]),
      ...xs.map((x): [number, number] => [x, 278]),
    ],
    edges,
  };
}

// Six wires in a chain: every one has to hold.
function series(): Topology {
  const n = 6;
  const x = (i: number) => 50 + (i * (W - 100)) / n;
  const inner = Array.from({ length: n - 1 }, (_, i): [number, number] => [x(i + 1), i % 2 ? 250 : 110]);
  return {
    id: 'series',
    name: 'Series',
    blurb: 'Six wires in a row. One break and it is over.',
    volatility: 'extreme',
    nodes: [[50, MID], [W - 50, MID], ...inner],
    edges: Array.from({ length: n }, (_, i): [number, number] => [i === 0 ? S : i + 1, i === n - 1 ? T : i + 2]),
  };
}

export const TOPOLOGIES: Record<TopologyId, Topology> = {
  parallel: parallel(),
  bridge: bridge(),
  ladder: ladder(),
  series: series(),
};

export const TOPOLOGY_IDS = Object.keys(TOPOLOGIES) as TopologyId[];

// ---- Graph helpers (wire sets are bitmasks: bit e = wire e) ----

export const allWires = (t: Topology) => (1 << t.edges.length) - 1;

export function popcount(m: number) {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
}

const lowBit = (m: number) => 31 - Math.clz32(m & -m);

/** Bitmask of nodes reachable from `from` through the wires in `wires`. */
export function reach(t: Topology, wires: number, from = S): number {
  let seen = 1 << from;
  for (let grew = true; grew; ) {
    grew = false;
    for (let m = wires; m; m &= m - 1) {
      const [a, b] = t.edges[lowBit(m)];
      if (((seen >> a) & 1) !== ((seen >> b) & 1)) {
        seen |= (1 << a) | (1 << b);
        grew = true;
      }
    }
  }
  return seen;
}

export const connects = (t: Topology, wires: number) => ((reach(t, wires) >> T) & 1) === 1;

/** A fully revealed live path exists: the win is guaranteed. */
export const isWon = (t: Topology, live: number) => connects(t, live);
/** The dead wires cut S from T: the round is lost. */
export const isLost = (t: Topology, dead: number) => !connects(t, allWires(t) & ~dead);

const connCache = new WeakMap<Topology, Uint8Array>();

/** conn[mask] = 1 if the wires in `mask` connect S to T. 2^E entries. */
function connTable(t: Topology): Uint8Array {
  let conn = connCache.get(t);
  if (!conn) {
    conn = new Uint8Array(1 << t.edges.length);
    for (let m = 0; m < conn.length; m++) conn[m] = connects(t, m) ? 1 : 0;
    connCache.set(t, conn);
  }
  return conn;
}

// ---- Exact reliability ----

export interface Analysis {
  /** P(S–T connected | revealed wires). */
  r: number;
  /** Per wire: r if that wire holds / snaps. Equal to r for revealed wires. */
  ifHolds: number[];
  ifSnaps: number[];
}

/**
 * One pass over every state of the unrevealed wires. Alongside r it collects,
 * per wire e, P(connected and e holds), which gives both conditional values:
 * ifHolds = that / q and ifSnaps = (r − that) / (1 − q).
 */
export function analyse(t: Topology, live: number, dead: number, q = Q): Analysis {
  const E = t.edges.length;
  const conn = connTable(t);
  const unknown = allWires(t) & ~live & ~dead;
  const u = popcount(unknown);
  const weight = Array.from({ length: u + 1 }, (_, k) => q ** k * (1 - q) ** (u - k));
  const both = new Array<number>(E).fill(0);
  let r = 0;
  for (let sub = unknown; ; sub = (sub - 1) & unknown) {
    if (conn[live | sub]) {
      const w = weight[popcount(sub)];
      r += w;
      for (let m = sub; m; m &= m - 1) both[lowBit(m)] += w;
    }
    if (sub === 0) break;
  }
  const ifHolds = both.map((x, e) => ((unknown >> e) & 1 ? x / q : r));
  const ifSnaps = both.map((x, e) => ((unknown >> e) & 1 ? (r - x) / (1 - q) : r));
  return { r, ifHolds, ifSnaps };
}

// Rounds revisit the same states constantly (and evals play millions), so cache at Q.
const analysisCache = new WeakMap<Topology, Map<number, Analysis>>();

export function analysis(t: Topology, live: number, dead: number): Analysis {
  let cache = analysisCache.get(t);
  if (!cache) analysisCache.set(t, (cache = new Map()));
  const key = live * 65536 + dead;
  let a = cache.get(key);
  if (!a) cache.set(key, (a = analyse(t, live, dead)));
  return a;
}

export const reliability = (t: Topology, q = Q) => analyse(t, 0, 0, q).r;

/** Whether revealing wire e could change the odds. Irrelevant wires are skipped. */
export const matters = (a: Analysis, e: number) => Math.abs(a.ifHolds[e] - a.ifSnaps[e]) > 1e-12;

/**
 * The next wire to reveal: the first unrevealed wire in the round's (shuffled)
 * order that still matters. The choice depends only on what has been revealed,
 * never on the hidden wires, so R_t stays a martingale.
 */
export function nextWire(t: Topology, live: number, dead: number, order: readonly number[]): number | null {
  const a = analysis(t, live, dead);
  const known = live | dead;
  for (const e of order) if (!((known >> e) & 1) && matters(a, e)) return e;
  return null;
}

// ---- Payouts ----

export const prize = (t: Topology) => RTP / reliability(t);
export const cashMultiplier = (t: Topology, r: number) => prize(t) * r;
export const maxMultiplier = () => Math.max(...TOPOLOGY_IDS.map((id) => prize(TOPOLOGIES[id])));

// ---- Display helpers ----

const pathCache = new WeakMap<Topology, number[]>();

/** Every simple S–T path as a wire bitmask, shortest first. */
export function simplePaths(t: Topology): number[] {
  let paths = pathCache.get(t);
  if (paths) return paths;
  paths = [];
  const walk = (node: number, visited: number, wires: number) => {
    if (node === T) return void paths!.push(wires);
    t.edges.forEach(([a, b], e) => {
      const other = a === node ? b : b === node ? a : -1;
      if (other >= 0 && !((visited >> other) & 1)) walk(other, visited | (1 << other), wires | (1 << e));
    });
  };
  walk(S, 1 << S, 0);
  paths.sort((x, y) => popcount(x) - popcount(y));
  pathCache.set(t, paths);
  return paths;
}

/** Wires on some S–T path with no dead wire: everything else can no longer carry power to T. */
export const usefulWires = (t: Topology, dead: number) =>
  simplePaths(t).reduce((acc, p) => (p & dead ? acc : acc | p), 0);

/** The shortest fully-live S–T path (0 if none). */
export const livePath = (t: Topology, live: number) => simplePaths(t).find((p) => (p & ~live) === 0) ?? 0;

/** The dead wires that separate what S can still reach from the rest. */
export function deadCut(t: Topology, dead: number): number {
  const side = reach(t, allWires(t) & ~dead);
  let cut = 0;
  t.edges.forEach(([a, b], e) => {
    if ((dead >> e) & 1 && ((side >> a) & 1) !== ((side >> b) & 1)) cut |= 1 << e;
  });
  return cut;
}

/** Hop distance from S through live wires (−1 if unpowered). Orients the current. */
export function liveDistances(t: Topology, live: number): number[] {
  const dist = t.nodes.map(() => -1);
  dist[S] = 0;
  for (let frontier = [S]; frontier.length; ) {
    const next: number[] = [];
    for (const n of frontier) {
      t.edges.forEach(([a, b], e) => {
        if (!((live >> e) & 1)) return;
        const other = a === n ? b : b === n ? a : -1;
        if (other >= 0 && dist[other] < 0) {
          dist[other] = dist[n] + 1;
          next.push(other);
        }
      });
    }
    frontier = next;
  }
  return dist;
}
