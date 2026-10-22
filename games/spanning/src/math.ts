// Spanning: a uniform spanning tree (UST) of a small grid graph is revealed
// edge by edge in a fixed sweep, top row first. You back 1–3 edges before the
// bet and win if every one of them is in the tree.
//
// Kirchhoff: for a uniform spanning tree, P(e ∈ T) is the effective
// resistance between e's endpoints when every edge is a 1 Ω resistor. Given
// what has been revealed (IN edges contracted, OUT edges deleted), the rest of
// the tree is a uniform spanning tree of that smaller graph, so revealing each
// edge with its *conditional* resistance samples the UST exactly.
//
// Burton–Pemantle (transfer-current theorem): P(e₁, …, e_k all ∈ T) is the
// determinant of the k×k matrix Y(eᵢ, eⱼ), the voltage across eⱼ when a unit
// current enters at eᵢ's tail and leaves at its head. We keep a grounded
// inverse Laplacian M of the current (contracted / deleted) graph, so
// Y(e, f) = b_eᵀ M b_f, and update it with rank-one Sherman–Morrison steps:
//   delete e:   M ← M + (M b)(M b)ᵀ / (1 − R_e)
//   contract e: M ← M − (M b)(M b)ᵀ / R_e         (the infinite-conductance limit)
// Bridges (R_e = 1) and loops (R_e = 0) are detected structurally with
// union–find, never by comparing floats. The tests check every probability
// against exact spanning-tree counts (matrix-tree theorem, BigInt Bareiss).
//
// Pricing: the prize is locked at RTP / P₀ with P₀ = τ(G / picks) / τ(G) from
// exact integer counts, and the cash-out is prize × P(win | revealed). That is
// a conditional expectation of the final payout, hence a martingale from RTP:
// every stopping rule returns exactly RTP. Which edges you back only trades
// chance for prize, never value.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const SIZES = ['3x3', '3x4', '4x4', '4x5'] as const;
export type Size = (typeof SIZES)[number];
export const MAX_PICKS = 3;

export interface GridEdge {
  u: number;
  v: number;
  /** Sweep layer: even = a row of horizontal edges, odd = the rungs below it. */
  layer: number;
  horizontal: boolean;
  /** Row and column of the edge's first (top / left) vertex. */
  r: number;
  c: number;
}

export interface Grid {
  size: Size;
  rows: number;
  cols: number;
  /** Vertices, numbered r * cols + c. */
  n: number;
  /** Edges in sweep order: the index is the reveal order. */
  edges: GridEdge[];
  layers: number;
  /** Neighbours of each vertex as flat [vertex, edge, vertex, edge, …]. */
  adj: number[][];
}

const grids = new Map<Size, Grid>();

export function grid(size: Size): Grid {
  let g = grids.get(size);
  if (g) return g;
  const [rows, cols] = size.split('x').map(Number);
  const edges: GridEdge[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) edges.push({ u: r * cols + c, v: r * cols + c + 1, layer: 2 * r, horizontal: true, r, c });
    if (r + 1 < rows) for (let c = 0; c < cols; c++) edges.push({ u: r * cols + c, v: (r + 1) * cols + c, layer: 2 * r + 1, horizontal: false, r, c });
  }
  const adj: number[][] = Array.from({ length: rows * cols }, () => []);
  edges.forEach(({ u, v }, i) => {
    adj[u].push(v, i);
    adj[v].push(u, i);
  });
  g = { size, rows, cols, n: rows * cols, edges, layers: 2 * rows - 1, adj };
  grids.set(size, g);
  return g;
}

export type EdgeStatus = 'in' | 'out' | null;

export interface TreeState {
  size: Size;
  /** Status of each edge, by sweep index. Edges before `next` are decided. */
  status: EdgeStatus[];
  next: number;
  /** Grounded inverse Laplacian of the current graph (n × n, row-major; the last vertex is ground). */
  M: Float64Array;
}

// ---- union–find helpers (structure is decided exactly, never by float) ----

// Two scratch union–find buffers, reused (the maths is synchronous).
const scratch = [new Int32Array(64), new Int32Array(64)];

function ufNew(n: number, slot = 0): Int32Array {
  const p = scratch[slot];
  for (let i = 0; i < n; i++) p[i] = i;
  return p;
}

function ufFind(p: Int32Array, x: number): number {
  while (p[x] !== x) x = p[x] = p[p[x]];
  return x;
}

/** Joins a and b; false if they were already joined. */
function ufUnion(p: Int32Array, a: number, b: number): boolean {
  const ra = ufFind(p, a);
  const rb = ufFind(p, b);
  if (ra === rb) return false;
  p[ra] = rb;
  return true;
}

// Structure is computed once per state and cached.
const compCache = new WeakMap<TreeState, Int32Array>();
const bridgeCache = new WeakMap<TreeState, Uint8Array>();

/** Component label of each vertex under the IN edges. */
function comps(st: TreeState): Int32Array {
  let c = compCache.get(st);
  if (c) return c;
  const g = grid(st.size);
  const uf = ufNew(g.n);
  for (let i = 0; i < g.edges.length; i++) if (st.status[i] === 'in') ufUnion(uf, g.edges[i].u, g.edges[i].v);
  c = new Int32Array(g.n);
  for (let v = 0; v < g.n; v++) c[v] = ufFind(uf, v);
  compCache.set(st, c);
  return c;
}

interface Dfs {
  g: Grid;
  status: EdgeStatus[];
  tin: Int32Array;
  low: Int32Array;
  t: number;
  found: Uint8Array;
}

function bridgeDfs(d: Dfs, v: number, viaEdge: number) {
  d.tin[v] = d.low[v] = d.t++;
  const nb = d.g.adj[v];
  for (let k = 0; k < nb.length; k += 2) {
    const w = nb[k];
    const i = nb[k + 1];
    if (i === viaEdge || d.status[i] === 'out') continue;
    if (d.tin[w] >= 0) d.low[v] = Math.min(d.low[v], d.tin[w]);
    else {
      bridgeDfs(d, w, i);
      d.low[v] = Math.min(d.low[v], d.low[w]);
      if (d.low[w] > d.tin[v]) d.found[i] = 1;
    }
  }
}

/** Bridges of the graph of edges not yet OUT (Tarjan's low-link). */
function bridges(st: TreeState): Uint8Array {
  let b = bridgeCache.get(st);
  if (b) return b;
  const g = grid(st.size);
  const d: Dfs = { g, status: st.status, tin: new Int32Array(g.n).fill(-1), low: new Int32Array(g.n), t: 0, found: new Uint8Array(g.edges.length) };
  for (let v = 0; v < g.n; v++) if (d.tin[v] < 0) bridgeDfs(d, v, -1);
  bridgeCache.set(st, d.found);
  return d.found;
}

/** True if e's endpoints are already joined by IN edges (e would close a cycle). */
export function isLoop(st: TreeState, e: number): boolean {
  const { u, v } = grid(st.size).edges[e];
  const c = comps(st);
  return c[u] === c[v];
}

/** True if every spanning tree of the current graph needs e (removing it would disconnect). */
export function isBridge(st: TreeState, e: number): boolean {
  return st.status[e] !== 'out' && bridges(st)[e] === 1;
}

// ---- linear algebra ----

const initialM = new Map<Size, Float64Array>();

/** Grounded inverse of the full grid's Laplacian (Gauss–Jordan, ground = last vertex). */
function groundedInverse(size: Size): Float64Array {
  const cached = initialM.get(size);
  if (cached) return cached;
  const g = grid(size);
  const n = g.n;
  const k = n - 1;
  const A = Array.from({ length: k }, () => new Float64Array(2 * k));
  for (const { u, v } of g.edges) {
    if (u < k) A[u][u] += 1;
    if (v < k) A[v][v] += 1;
    if (u < k && v < k) {
      A[u][v] -= 1;
      A[v][u] -= 1;
    }
  }
  for (let i = 0; i < k; i++) A[i][k + i] = 1;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * k; j++) A[col][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col || A[r][col] === 0) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * k; j++) A[r][j] -= f * A[col][j];
    }
  }
  const M = new Float64Array(n * n);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) M[i * n + j] = A[i][k + j];
  initialM.set(size, M);
  return M;
}

/** The transfer current Y(e, f) = b_eᵀ M b_f in the current graph. */
export function transfer(st: TreeState, e: number, f: number): number {
  const g = grid(st.size);
  const n = g.n;
  const { u: a, v: b } = g.edges[e];
  const { u: c, v: d } = g.edges[f];
  const M = st.M;
  return M[a * n + c] - M[a * n + d] - M[b * n + c] + M[b * n + d];
}

export function initialState(size: Size): TreeState {
  return { size, status: grid(size).edges.map(() => null), next: 0, M: groundedInverse(size).slice() };
}

/** P(e ∈ T | what is revealed): the effective resistance across e (Kirchhoff). */
export function marginal(st: TreeState, e: number): number {
  const s = st.status[e];
  if (s) return s === 'in' ? 1 : 0;
  if (isLoop(st, e)) return 0;
  if (isBridge(st, e)) return 1;
  return Math.min(1, Math.max(0, transfer(st, e, e)));
}

/** Sets e to IN (contract) or OUT (delete), updating M by a rank-one step. */
function setEdge(st: TreeState, e: number, inTree: boolean): TreeState {
  const g = grid(st.size);
  const n = g.n;
  const status = st.status.slice();
  status[e] = inTree ? 'in' : 'out';
  const M = st.M.slice();
  // A loop changes nothing, and a bridge is never deleted (its chance is exactly 1).
  if (!isLoop(st, e)) {
    const { u, v } = g.edges[e];
    const R = transfer(st, e, e);
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = st.M[i * n + u] - st.M[i * n + v];
    const scale = inTree ? -1 / R : 1 / (1 - R);
    for (let i = 0; i < n; i++) {
      const wi = w[i] * scale;
      if (wi === 0) continue;
      for (let j = 0; j < n; j++) M[i * n + j] += wi * w[j];
    }
  }
  const out: TreeState = { size: st.size, status, next: st.next, M };
  // Carry the cached structure forward: IN merges two labels and keeps every
  // bridge (contraction never creates or removes one); OUT keeps the labels.
  const c = compCache.get(st);
  if (c && !inTree) compCache.set(out, c);
  if (c && inTree) {
    const from = c[g.edges[e].u];
    const to = c[g.edges[e].v];
    compCache.set(out, from === to ? c : c.map((x) => (x === from ? to : x)));
  }
  const b = bridgeCache.get(st);
  if (b && inTree) bridgeCache.set(out, b);
  return out;
}

/** Reveals the next edge in the sweep as IN or OUT. */
export function decide(st: TreeState, inTree: boolean): TreeState {
  return { ...setEdge(st, st.next, inTree), next: st.next + 1 };
}

/** Determinant of a small (≤ 3×3) matrix. */
function det(a: number[][]): number {
  if (a.length === 0) return 1;
  if (a.length === 1) return a[0][0];
  if (a.length === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
  return (
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  );
}

/** A backed edge: you need it IN the tree, or (laid) OUT of it. */
export interface Pick {
  edge: number;
  want: 'in' | 'out';
}

const openPicks = (st: TreeState, picks: readonly Pick[]) => picks.filter((p) => st.status[p.edge] === null);

/** 'win' / 'lose' once every backed edge is settled or forced, else null. Decided structurally. */
export function resolution(st: TreeState, picks: readonly Pick[]): 'win' | 'lose' | null {
  if (picks.some((p) => st.status[p.edge] !== null && st.status[p.edge] !== p.want)) return 'lose';
  const open = openPicks(st, picks);
  if (open.length === 0) return 'win';
  // Some tree must hold IN ∪ open IN-picks (no cycle) and avoid the open OUT-picks (still connected).
  const g = grid(st.size);
  const c = comps(st);
  const uf = ufNew(g.n);
  for (const p of open) if (p.want === 'in' && !ufUnion(uf, c[g.edges[p.edge].u], c[g.edges[p.edge].v])) return 'lose';
  if (open.some((p) => p.want === 'out')) {
    const conn = ufNew(g.n, 1);
    let parts = g.n;
    for (let i = 0; i < g.edges.length; i++) {
      if (st.status[i] === 'out' || open.some((p) => p.edge === i && p.want === 'out')) continue;
      if (ufUnion(conn, g.edges[i].u, g.edges[i].v)) parts--;
    }
    if (parts > 1) return 'lose';
  }
  // Won once every open pick is forced: IN-picks are bridges, OUT-picks are loops.
  if (open.every((p) => (p.want === 'in' ? isBridge(st, p.edge) : isLoop(st, p.edge)))) return 'win';
  return null;
}

/**
 * P(every backed edge as wanted | revealed). Burton–Pemantle: the UST is a
 * determinantal process with kernel Y, so this is the determinant of Y on the
 * open picks, with the row of each OUT-pick replaced by that row of I − Y.
 */
export function winChance(st: TreeState, picks: readonly Pick[]): number {
  const r = resolution(st, picks);
  if (r) return r === 'win' ? 1 : 0;
  const open = openPicks(st, picks);
  const row = (a: Pick, i: number) =>
    open.map((b, j) => (a.want === 'in' ? transfer(st, a.edge, b.edge) : (i === j ? 1 : 0) - transfer(st, a.edge, b.edge)));
  return Math.min(1, Math.max(0, det(open.map(row))));
}

/** P(this pick comes out as wanted | revealed): the resistance across it, or one minus it. */
export function pickChance(st: TreeState, p: Pick): number {
  const m = marginal(st, p.edge);
  return p.want === 'in' ? m : 1 - m;
}

/**
 * Sequential factors P(pick₁) · P(pick₂ | pick₁) · P(pick₃ | pick₁, pick₂) of
 * the win chance, drawn as a funnel of bars. Their product is winChance.
 */
export function chainFactors(st: TreeState, picks: readonly Pick[]): number[] {
  let s = st;
  const out: number[] = [];
  for (const p of picks) {
    if (out.length && out[out.length - 1] === 0) {
      out.push(0);
      continue;
    }
    const f = pickChance(s, p);
    out.push(f);
    if (f > 0 && s.status[p.edge] === null) s = setEdge(s, p.edge, p.want === 'in');
  }
  return out;
}

export interface Reveal {
  edge: number;
  inTree: boolean;
}

/**
 * One step: the sweep reveals the rest of its current layer, edge by edge,
 * each IN with its exact conditional chance (IN iff u < p). It stops early
 * once the backed edges are settled. Every outcome is decided here, up front.
 */
export function step(st: TreeState, picks: readonly Pick[], rng: Rng): { state: TreeState; reveals: Reveal[] } {
  const g = grid(st.size);
  const layer = g.edges[st.next]?.layer;
  const reveals: Reveal[] = [];
  let s = st;
  while (s.next < g.edges.length && g.edges[s.next].layer === layer && !resolution(s, picks)) {
    const p = marginal(s, s.next);
    const inTree = rng.next() < p;
    reveals.push({ edge: s.next, inTree });
    s = decide(s, inTree);
  }
  return { state: s, reveals };
}

// ---- exact spanning-tree counts (matrix-tree theorem, BigInt) ----

/**
 * Number of spanning trees of the grid after contracting `contract` edges and
 * deleting `remove` edges. Exact: fraction-free Bareiss elimination on the
 * reduced Laplacian of the contracted multigraph.
 */
export function treeCount(size: Size, contract: readonly number[], remove: readonly number[] = []): bigint {
  const g = grid(size);
  const uf = ufNew(g.n);
  const find = (v: number) => ufFind(uf, v);
  for (const e of contract) if (!ufUnion(uf, g.edges[e].u, g.edges[e].v)) return 0n; // a cycle
  const roots = [...new Set(Array.from({ length: g.n }, (_, i) => find(i)))];
  const idx = new Map(roots.map((r, i) => [r, i]));
  const k = roots.length - 1; // ground the last class
  if (k === 0) return 1n;
  const A: bigint[][] = Array.from({ length: k }, () => Array<bigint>(k).fill(0n));
  const gone = new Set(remove);
  g.edges.forEach(({ u, v }, i) => {
    if (gone.has(i)) return;
    const a = idx.get(find(u))!;
    const b = idx.get(find(v))!;
    if (a === b) return;
    if (a < k) A[a][a] += 1n;
    if (b < k) A[b][b] += 1n;
    if (a < k && b < k) {
      A[a][b] -= 1n;
      A[b][a] -= 1n;
    }
  });
  let prev = 1n;
  let sign = 1n;
  for (let i = 0; i < k; i++) {
    if (A[i][i] === 0n) {
      const r = A.findIndex((row, j) => j > i && row[i] !== 0n);
      if (r < 0) return 0n;
      [A[i], A[r]] = [A[r], A[i]];
      sign = -sign;
    }
    for (let r = i + 1; r < k; r++) {
      for (let c = i + 1; c < k; c++) A[r][c] = (A[r][c] * A[i][i] - A[r][i] * A[i][c]) / prev;
      A[r][i] = 0n;
    }
    prev = A[i][i];
  }
  return sign * A[k - 1][k - 1];
}

const ratio = (a: bigint, b: bigint) => Number((a * 10n ** 18n) / b) / 1e18;

const keyOf = (picks: readonly Pick[]) =>
  [...picks]
    .sort((a, b) => a.edge - b.edge)
    .map((p) => (p.want === 'in' ? '+' : '-') + p.edge)
    .join('');

const p0Cache = new Map<string, number>();

/** Exact chance at the start: τ(G / IN-picks − OUT-picks) / τ(G), from integer counts. */
export function startChance(size: Size, picks: readonly Pick[]): number {
  const key = `${size}:${keyOf(picks)}`;
  let p = p0Cache.get(key);
  if (p === undefined) {
    const ins = picks.filter((x) => x.want === 'in').map((x) => x.edge);
    const outs = picks.filter((x) => x.want === 'out').map((x) => x.edge);
    p = ratio(treeCount(size, ins, outs), treeCount(size, []));
    p0Cache.set(key, p);
  }
  return p;
}

export const prizeFor = (size: Size, picks: readonly Pick[]) => RTP / startChance(size, picks);

// ---- choices, presets and volatility ----

const sets = new Map<Size, { picks: Pick[]; p: number }[]>();

/** Every possible set of 1–3 backed edges (each IN or OUT) with its starting chance. */
export function allSets(size: Size) {
  let list = sets.get(size);
  if (list) return list;
  const E = grid(size).edges.length;
  // For ranking only, so the fast transfer-current determinant is enough;
  // prizes always come from the exact integer counts.
  const st = initialState(size);
  const out: { picks: Pick[]; p: number }[] = [];
  const add = (edges: number[]) => {
    for (let m = 0; m < 1 << edges.length; m++) {
      const picks = edges.map((edge, i): Pick => ({ edge, want: (m >> i) & 1 ? 'out' : 'in' }));
      const p = winChance(st, picks);
      // Impossible sets (laid edges that cut a dot off) can't be backed.
      if (p > 0) out.push({ picks, p });
    }
  };
  for (let a = 0; a < E; a++) {
    add([a]);
    for (let b = a + 1; b < E; b++) {
      add([a, b]);
      for (let c = b + 1; c < E; c++) add([a, b, c]);
    }
  }
  sets.set(size, out);
  return out;
}

/**
 * The smallest starting chance of any possible set: 4 of the 3×3 grid's 192
 * trees avoid three laid edges such as two at the top-middle dot plus a bottom
 * edge. The tests recompute it over every set. The largest prize, and so the
 * largest payout, is RTP / this = 47.52×.
 */
export const MIN_START_CHANCE = 1 / 48;
export const MAX_MULTIPLIER = 48;

export type QuickPick = 'safe' | 'random' | 'long';

const pools = new Map<string, { picks: Pick[]; p: number }[]>();

/**
 * k random backed edges: 'safe' draws from the likeliest quarter of sets,
 * 'long' from the least likely quarter, 'random' from all of them.
 */
export function quickPicks(size: Size, k: number, kind: QuickPick, rng: Rng): Pick[] {
  const key = `${size}:${k}:${kind}`;
  let pool = pools.get(key);
  if (!pool) {
    const all = allSets(size).filter((x) => x.picks.length === k);
    const sorted = kind === 'random' ? all : [...all].sort((a, b) => (kind === 'safe' ? b.p - a.p : a.p - b.p));
    pool = kind === 'random' ? sorted : sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
    pools.set(key, pool);
  }
  return pool[rng.int(pool.length)].picks.map((p) => ({ ...p }));
}

export function volatilityOf(p0: number): Volatility {
  return p0 > 0.45 ? 'low' : p0 > 0.2 ? 'medium' : p0 > 0.07 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { size: Size; k: number; kind: QuickPick }> = {
  low: { size: '3x3', k: 1, kind: 'safe' },
  medium: { size: '3x4', k: 2, kind: 'random' },
  high: { size: '4x4', k: 3, kind: 'random' },
  extreme: { size: '4x5', k: 3, kind: 'long' },
};
