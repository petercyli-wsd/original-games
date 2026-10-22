// Bootstrap: k seed cells land at random (distinct, uniform) on an n×n grid,
// one at a time. After each seed, infection spreads by the 2-neighbour
// bootstrap rule: any healthy cell with at least two infected neighbours
// (up, down, left, right) becomes infected, repeated until nothing changes.
// Bet that the grid ends up fully infected ("Full grid") or not ("Not full").
//
// Why spreading after every seed is the same game as spreading once at the
// end: closure is monotone and idempotent, cl(A ∪ B) = cl(cl(A) ∪ B).
//
// The perimeter theorem: when a cell with ≥ 2 infected neighbours joins, the
// perimeter of the infected set (edges between infected and healthy cells,
// counting the grid's outer edge) changes by 4 − 2·(infected neighbours) ≤ 0.
// So spreading never grows the perimeter, and each seed adds at most 4. The
// full grid has perimeter 4n, so it needs at least n seeds, and at any moment
// perimeter + 4 × (seeds left) is a budget that must still reach 4n. The board
// draws that budget as a bar.
//
// Exact pricing. The state is (C, a): the infected (closed) set C and the
// number of seeds a placed so far (all inside C). The next seed is uniform on
// the N − a non-seed cells: |C| − a of them are inside C and change nothing,
// each of the others x moves to cl(C ∪ {x}). We count ordered seed sequences
// that end full, Seq(C, a), by memoised recursion, with two exact shortcuts:
// C full → every sequence wins; budget < 4n → none do. Then
//   P(full | C, a) = Seq(C, a) / (N − a)(N − a − 1)…(N − k + 1),
// in integers below 2^53, so P is exact (0 and 1 are detected exactly).
//
// Fairness (pattern 1, fixed prize): prize = RTP / P(win at start), and
// cash-out(S) = prize × P(win | S). P(win | S) is a martingale over the seed
// draws, so the cash-out is too, starting at RTP; by optional stopping every
// strategy returns exactly RTP. The round auto-settles as soon as P is 0 or 1.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const SIZES = [4, 5] as const;
export type Size = (typeof SIZES)[number];

export type Side = 'full' | 'not';
export const SIDES: Side[] = ['full', 'not'];

/** Seed counts offered for each grid size. */
export const SEEDS: Record<Size, readonly number[]> = {
  4: [4, 5, 6, 7, 8],
  5: [5, 6, 7, 8, 9, 10],
};

export interface Settings {
  n: Size;
  k: number;
  side: Side;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { n: 4, k: 8, side: 'full' },
  medium: { n: 5, k: 8, side: 'not' },
  high: { n: 5, k: 6, side: 'full' },
  extreme: { n: 5, k: 5, side: 'full' },
};

// ---------------------------------------------------------------- bitmasks

export const cells = (n: number) => n * n;
export const allMask = (n: number) => 2 ** (n * n) - 1;
export const bit = (i: number) => 1 << i;
export const has = (mask: number, i: number) => (mask & (1 << i)) !== 0;

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

interface Geo {
  all: number;
  /** Cells not in the last column / not in the first column. */
  notLast: number;
  notFirst: number;
}
const geoCache = new Map<number, Geo>();
function geo(n: number): Geo {
  let g = geoCache.get(n);
  if (!g) {
    let notLast = 0;
    let notFirst = 0;
    for (let i = 0; i < n * n; i++) {
      if (i % n !== n - 1) notLast |= 1 << i;
      if (i % n !== 0) notFirst |= 1 << i;
    }
    g = { all: allMask(n), notLast, notFirst };
    geoCache.set(n, g);
  }
  return g;
}

/** Healthy cells with at least two infected neighbours: the next wave. */
export function wave(S: number, n: number): number {
  const { all, notLast, notFirst } = geo(n);
  const a = S >>> n; // infected neighbour below
  const b = (S << n) & all; // infected neighbour above
  const c = (S >>> 1) & notLast; // infected neighbour to the right
  const d = (S << 1) & notFirst; // infected neighbour to the left
  const two = (a & b) | (a & c) | (a & d) | (b & c) | (b & d) | (c & d);
  return two & ~S & all;
}

/** The bootstrap closure of S. */
export function closure(S: number, n: number): number {
  for (let w = wave(S, n); w; w = wave(S, n)) S |= w;
  return S;
}

/** The successive waves of spreading from S (each a bitmask), for animation. */
export function waves(S: number, n: number): number[] {
  const out: number[] = [];
  for (let w = wave(S, n); w; w = wave(S, n)) {
    out.push(w);
    S |= w;
  }
  return out;
}

/** Edges between infected and healthy cells, the grid's outer edge counting as healthy. */
export function perimeter(S: number, n: number): number {
  const { notLast } = geo(n);
  const vertical = popcount(S & (S >>> n));
  const horizontal = popcount(S & (S >>> 1) & notLast);
  return 4 * popcount(S) - 2 * (vertical + horizontal);
}

/** The most perimeter the final infected set could still have: now + 4 per seed left. */
export const budget = (C: number, seedsLeft: number, n: number) => perimeter(C, n) + 4 * seedsLeft;

// ----------------------------------------------------------- exact counts

/** (m)(m−1)…(m−r+1): ordered ways to place r more seeds among m free cells. */
export function falling(m: number, r: number): number {
  let x = 1;
  for (let i = 0; i < r; i++) x *= m - i;
  return x;
}

/** Most seeds offered on each grid size: the graph of closed sets is built to this depth. */
export const KMAX: Record<Size, number> = { 4: 8, 5: 10 };

interface Graph {
  /** Closed infected sets that can still matter, as bitmasks. */
  masks: number[];
  index: Map<number, number>;
  /** kids[c·N + i]: index of cl(C ∪ {i}) for a healthy cell i, −1 if C ∪ {i} can no longer fill the grid, −2 if i ∈ C. */
  kids: Int32Array;
  pop: Int8Array;
  per: Int16Array;
}

const graphCache = new Map<number, Graph>();

/**
 * Every closed set reachable from the empty grid with at most KMAX seeds
 * whose perimeter budget can still reach 4n (BFS by fewest seeds), with its
 * one-seed transitions. Sets left out can only lose, so they count as 0.
 */
export function graph(n: Size): Graph {
  const cached = graphCache.get(n);
  if (cached) return cached;
  const N = n * n;
  const all = allMask(n);
  const K = KMAX[n];
  const masks = [0];
  const index = new Map([[0, 0]]);
  const kidList: number[] = [];
  let frontier = [0];
  for (let d = 0; d <= K; d++) {
    const next: number[] = [];
    for (const C of frontier) {
      for (let i = 0; i < N; i++) {
        if (C & (1 << i)) {
          kidList.push(-2);
          continue;
        }
        const X = closure(C | (1 << i), n);
        let id = index.get(X);
        if (id === undefined && d < K && (X === all || perimeter(X, n) + 4 * (K - d - 1) >= 4 * n)) {
          id = masks.length;
          masks.push(X);
          index.set(X, id);
          next.push(X);
        }
        kidList.push(id ?? -1);
      }
    }
    frontier = next;
  }
  const g: Graph = {
    masks,
    index,
    kids: Int32Array.from(kidList),
    pop: Int8Array.from(masks, popcount),
    per: Int16Array.from(masks, (m) => perimeter(m, n)),
  };
  graphCache.set(n, g);
  return g;
}

const seqCache = new Map<string, Float64Array[]>();

/**
 * seq[a][c]: ordered ways to place the remaining k − a seeds on non-seed cells
 * so the grid ends full, from infected set masks[c] after a seeds. Exact
 * integers (below 2^53 for these sizes).
 */
function sequences(n: Size, k: number): Float64Array[] {
  const key = `${n}:${k}`;
  const hit = seqCache.get(key);
  if (hit) return hit;
  if (k > KMAX[n]) throw new Error(`at most ${KMAX[n]} seeds on ${n}×${n}`);
  const { masks, kids, pop, per } = graph(n);
  const N = n * n;
  const all = allMask(n);
  const len = masks.length;
  const seq: Float64Array[] = new Array(k + 1);
  seq[k] = Float64Array.from(masks, (m) => (m === all ? 1 : 0));
  for (let a = k - 1; a >= 0; a--) {
    const r = k - a;
    const up = seq[a + 1];
    const cur = new Float64Array(len);
    const allWays = falling(N - a, r);
    for (let c = 0; c < len; c++) {
      if (masks[c] === all) {
        cur[c] = allWays;
        continue;
      }
      if (per[c] + 4 * r < 4 * n) continue;
      let t = Math.max(0, pop[c] - a) * up[c];
      const base = c * N;
      for (let i = 0; i < N; i++) {
        const kid = kids[base + i];
        if (kid >= 0) t += up[kid];
      }
      cur[c] = t;
    }
    seq[a] = cur;
  }
  seqCache.set(key, seq);
  return seq;
}

/** Ordered completions of the remaining seeds that end with the full grid. */
export function fullSequences(C: number, a: number, n: Size, k: number): number {
  const c = graph(n).index.get(C);
  return c === undefined ? 0 : sequences(n, k)[a][c];
}

/** Exact chance the grid ends fully infected, given infected set C after a seeds. */
export function pFull(C: number, a: number, n: Size, k: number): number {
  if (C === allMask(n)) return 1;
  return fullSequences(C, a, n, k) / falling(n * n - a, k - a);
}

export const pWin = (side: Side, C: number, a: number, n: Size, k: number) =>
  side === 'full' ? pFull(C, a, n, k) : 1 - pFull(C, a, n, k);

const startCache = new Map<string, number>();
/** Chance to win from the empty grid. */
export function startChance({ n, k, side }: Settings): number {
  const key = `${n}:${k}`;
  let p = startCache.get(key);
  if (p === undefined) startCache.set(key, (p = pFull(0, 0, n, k)));
  return side === 'full' ? p : 1 - p;
}

/** The fixed prize for a full win. */
export const prizeFor = (s: Settings) => RTP / startChance(s);

/** Fair cash-out multiplier at a state. */
export const cashOut = (s: Settings, C: number, a: number) => prizeFor(s) * pWin(s.side, C, a, s.n, s.k);

/**
 * Honest bound on any payout: the cash-out never exceeds the prize, and the
 * biggest prize on offer is Full grid on 5×5 with 5 seeds, 0.99 / 0.030397…
 * = 32.57×. (Checked against every setting in the tests.)
 */
export const MAX_MULTIPLIER = 33;

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.5 ? 'low' : p > 0.2 ? 'medium' : p > 0.06 ? 'high' : 'extreme';
}

/** Every setting the game can offer. */
export function allSettings(): Settings[] {
  return SIZES.flatMap((n) => SEEDS[n].flatMap((k) => SIDES.map((side) => ({ n, k, side }))));
}

// ------------------------------------------------------------ one round

export interface State {
  /** Seed cells, in landing order. */
  seeds: number[];
  /** Infected set (closed). */
  C: number;
}

/** Drops the next seed: uniform over the non-seed cells. `u` is in [0, 1). */
export function nextSeed(st: State, n: Size, u: number): number {
  const free: number[] = [];
  for (let i = 0; i < n * n; i++) if (!st.seeds.includes(i)) free.push(i);
  return free[Math.min(free.length - 1, Math.floor(u * free.length))];
}

export function addSeed(st: State, cell: number, n: Size): State {
  return { seeds: [...st.seeds, cell], C: closure(st.C | (1 << cell), n) };
}
