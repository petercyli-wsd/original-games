// Connect: n nodes sit on a circle with no edges. Edges are added one at a
// time, each a uniformly random pair that is not yet joined (the Erdős–Rényi
// random graph process). You set an edge budget E ≥ n − 1 and back one side:
//   Connected  the graph is connected once E edges are placed,
//   Split      it is still in two or more pieces after E edges.
//
// Exact odds. Which pair comes next depends only on totals: with m edges
// placed there are C(n, 2) − m open pairs, and the cross pairs (joining two
// different components) number Σ_{i<j} s_i·s_j for component sizes s. Every
// edge lies inside a component, so the open pairs inside components are the
// rest. The next edge therefore
//   joins components i and j   with chance s_i·s_j / (C(n, 2) − m),
//   stays inside a component   with chance (Σ C(s_i, 2) − m) / (C(n, 2) − m),
// and (multiset of component sizes, m) is a Markov chain. P(connected after E
// edges | state) is an exact DP over at most 42 partitions × 45 edge counts;
// no sampling is ever used. With E = n − 1 it is Cayley's count of trees over
// all edge sets, n^(n−2) / C(C(n, 2), n − 1).
//
// Pricing (fixed prize). Backing a side with chance P₀ pays prize = RTP / P₀,
// and the cash-out in any state is prize · P(win | state). The next edge is
// a uniformly random open pair and P(win | state) is the average of P over
// the states it can lead to, so the cash-out is a martingale starting at RTP:
// by optional stopping every cash-out rule returns exactly RTP. The side and
// budget are chosen before the bet and only trade chance for prize.
//
// Early ends (stopping rules, so RTP is unchanged). Connected is certain once
// there is one component, and impossible when the k components need more
// than the E − m edges left (k − 1 merges). Split stays possible exactly while
// the graph can still be cut in two with E edges in total: some group of
// components holding a nodes, with C(a, 2) + C(n − a, 2) ≥ E. That is largest
// for a = the smallest component, so Split is impossible (Connected certain)
// when E > C(s_min, 2) + C(n − s_min, 2). The round ends as soon as either
// side's chance is 0 or 1, so a step with bust chance 1 is never offered.
// The largest payout is the largest prize on the menu (budgets are offered
// only while both sides keep a 1% chance: at most 99×, in fact ≈ 91.4× for
// Split with 7 nodes and 12 edges), so the max multiplier needs no cap.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Side = 'connect' | 'split';
export const SIDES: readonly Side[] = ['connect', 'split'];
export const SIDE_NAME: Record<Side, string> = { connect: 'Connected', split: 'Split' };

export const NODES = [6, 7, 8, 9, 10] as const;
export type Nodes = (typeof NODES)[number];

/** Budget = a spanning tree (n − 1 edges) plus this many spare edges. */
export const SPARES = [0, 1, 2, 4, 6, 8, 10] as const;
export type Spare = (typeof SPARES)[number];

export const pairs = (n: number) => (n * (n - 1)) / 2;
export const budgetOf = (n: number, spare: number) => n - 1 + spare;

export const VOLATILITY: Record<Volatility, { side: Side; n: Nodes; spare: Spare }> = {
  low: { side: 'connect', n: 8, spare: 6 },
  medium: { side: 'connect', n: 8, spare: 1 },
  high: { side: 'split', n: 8, spare: 4 },
  extreme: { side: 'split', n: 10, spare: 10 },
};

/** Component sizes, largest first. */
export type Parts = readonly number[];

const keyOf = (parts: Parts) => parts.join(',');

/** Merge components i and j (indices into parts), keeping the order. */
export function mergeParts(parts: Parts, i: number, j: number): number[] {
  const out = parts.filter((_, t) => t !== i && t !== j);
  out.push(parts[i] + parts[j]);
  return out.sort((a, b) => b - a);
}

/** Pairs joining two different components: Σ_{i<j} s_i s_j. */
export function crossPairs(parts: Parts): number {
  let sum = 0;
  let sq = 0;
  for (const s of parts) {
    sum += s;
    sq += s * s;
  }
  return (sum * sum - sq) / 2;
}

/** Open (unjoined) pairs after m edges. */
export const openPairs = (n: number, m: number) => pairs(n) - m;

/** Chance the next edge joins two components. */
export const mergeChance = (parts: Parts, m: number) => {
  const n = parts.reduce((a, b) => a + b, 0);
  return crossPairs(parts) / openPairs(n, m);
};

/** Whether the graph can still be split after E edges in total. */
export function splitPossible(parts: Parts, E: number): boolean {
  if (parts.length < 2) return false;
  const n = parts.reduce((a, b) => a + b, 0);
  const a = parts[parts.length - 1];
  return E <= pairs(a) + pairs(n - a);
}

/** Whether the graph can still be connected with E edges in total. */
export const connectPossible = (parts: Parts, m: number, E: number) => parts.length - 1 <= E - m;

const memo = new Map<string, number>();

/** Exact P(connected once E edges are placed | sizes, m edges placed). */
export function connectChance(parts: Parts, m: number, E: number): number {
  const k = parts.length;
  if (k === 1) return 1;
  if (!connectPossible(parts, m, E)) return 0;
  if (!splitPossible(parts, E)) return 1;
  const key = `${keyOf(parts)}|${m}|${E}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const n = parts.reduce((a, b) => a + b, 0);
  const open = openPairs(n, m);
  const internal = open - crossPairs(parts);
  let p = internal > 0 ? (internal / open) * connectChance(parts, m + 1, E) : 0;
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) p += ((parts[i] * parts[j]) / open) * connectChance(mergeParts(parts, i, j), m + 1, E);
  }
  memo.set(key, p);
  return p;
}

export const singletons = (n: number): number[] => Array.from({ length: n }, () => 1);

/** Chance the backed side wins from this state. */
export const winChance = (side: Side, parts: Parts, m: number, E: number) => {
  const c = connectChance(parts, m, E);
  return side === 'connect' ? c : 1 - c;
};

/** Chance of the side at the start (no edges). */
export const startChance = (side: Side, n: number, spare: number) => winChance(side, singletons(n), 0, budgetOf(n, spare));

export const prizeFor = (side: Side, n: number, spare: number) => RTP / startChance(side, n, spare);

/**
 * A budget is offered for n nodes only while both sides keep at least a 1%
 * chance, so no prize tops 99× and no bet is a foregone conclusion.
 */
export const MIN_CHANCE = 0.01;
export function offered(n: number, spare: number): boolean {
  const p = startChance('connect', n, spare);
  return Math.min(p, 1 - p) >= MIN_CHANCE;
}

/** The nearest offered budget at or below the one asked for. */
export function clampSpare(n: number, spare: Spare): Spare {
  const ok = SPARES.filter((x) => x <= spare && offered(n, x));
  return ok.length ? ok[ok.length - 1] : SPARES[0];
}

/** The round is over: the graph is connected, or one side has become impossible. */
export const decided = (parts: Parts, m: number, E: number) =>
  parts.length === 1 || !connectPossible(parts, m, E) || !splitPossible(parts, E);

export function volatilityOf(side: Side, n: number, spare: number): Volatility {
  const p = startChance(side, n, spare);
  return p > 0.5 ? 'low' : p > 0.2 ? 'medium' : p > 0.04 ? 'high' : 'extreme';
}

/** Every prize on the menu is offered as is, so the largest is a true bound. */
export const MAX_MULTIPLIER = Math.max(
  ...SIDES.flatMap((s) => NODES.flatMap((n) => SPARES.filter((x) => offered(n, x)).map((x) => prizeFor(s, n, x)))),
);

// ---------------------------------------------------------------------------
// The actual graph (for the board, the round and the tests).

export type Edge = readonly [number, number];

/** Component label of every node (the smallest node in its component). */
export function components(n: number, edges: readonly Edge[]): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  return parent.map((_, i) => find(i));
}

/** Component sizes, largest first. */
export function partsOf(n: number, edges: readonly Edge[]): number[] {
  const count = new Map<number, number>();
  for (const c of components(n, edges)) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.values()].sort((a, b) => b - a);
}

export interface OpenPair {
  a: number;
  b: number;
  /** Joins two different components. */
  cross: boolean;
}

/** Every open pair, cross pairs first: the next edge is a uniform pick from this list. */
export function openPairList(n: number, edges: readonly Edge[]): OpenPair[] {
  const comp = components(n, edges);
  const joined = new Set(edges.map(([a, b]) => Math.min(a, b) * n + Math.max(a, b)));
  const cross: OpenPair[] = [];
  const inner: OpenPair[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (joined.has(a * n + b)) continue;
      (comp[a] !== comp[b] ? cross : inner).push({ a, b, cross: comp[a] !== comp[b] });
    }
  }
  return [...cross, ...inner];
}
