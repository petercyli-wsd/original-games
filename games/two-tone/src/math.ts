// Two-Tone: n nodes sit on a ring. Random edges appear one at a time, each a
// uniformly random pair among the pairs not yet joined. You survive while the
// graph is bipartite: while its nodes can be split into two tones with every
// edge joining a light node to a dark one (equivalently, no odd cycle). Place
// the target number of edges and the round pays out.
//
// Reading the risk. Colour every connected component with its two tones (a
// lone node has no tone yet). A new edge u–v
//   - between two components always keeps the graph bipartite (flip one
//     component's tones if needed);
//   - inside a component, across the two tones, closes an even cycle: safe;
//   - inside a component, between two nodes of the same tone, closes an odd
//     cycle: fatal.
// So the fatal pairs are exactly the same-tone pairs within a component, and
// none of them can already be an edge. With components whose tone classes
// have sizes (a_i, b_i) and m edges placed,
//
//   fatal = Σ C(a_i, 2) + C(b_i, 2),   open = C(n, 2) − m,   q = fatal / open.
//
// The board draws every fatal pair (faint red chords on the ring, red cells
// in the pair grid), so the next edge's bust chance is a literal count.
//
// Pricing (per-step fair factor). Surviving an edge with bust chance q
// multiplies the cash-out by 1/(1 − q), so E[cash-out after] = cash-out now:
// the cash-out is a martingale starting at RTP and, by optional stopping,
// every way of playing returns exactly RTP. Edges with q = 0 (while the graph
// is a matching) are free and are placed automatically: skipping a checkpoint
// that cannot change the value is a stopping rule too. When every open pair is
// fatal (the graph is a complete bipartite K(a, b)), q = 1 is never offered:
// the round cashes out automatically.
//
// The theorem. After m steps the random graph process is a uniform random
// graph G(n, m), so the chance of placing E edges with no odd cycle is
//
//   P(G(n, E) is bipartite) = B(n, E) / C(C(n, 2), E),
//
// where B(n, E) counts labelled bipartite graphs. A connected bipartite graph
// has exactly two proper 2-colourings, so 2-coloured graphs are "bipartite
// graphs, with each component coloured twice": in exponential generating
// functions, Σ B_n(y) xⁿ/n! = √( Σ_n Σ_k C(n, k) (1 + y)^{k(n−k)} xⁿ/n! ).
// bipartiteCounts expands that square root exactly (BigInt).
//
// The live chance to finish depends only on the multiset of tone-class sizes
// (a_i, b_i) and the edge count, so finishChance is an exact DP over those
// profiles (it agrees with the closed form above to 1e-12; see the tests).
//
// Max win. Every factor is a ratio of integers below C(n, 2), and a round has
// at most E steps, so the cash-out is bounded. maxMultiplier finds the exact
// worst case by the same DP (maximising the product of factors). Targets
// above n + 2 edges are not offered, which keeps every payout under
// MAX_MULTIPLIER without a cap (a cap would make the finish chance path
// dependent).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Nodes on the ring. Fewer nodes means a denser graph and sooner odd cycles. */
export const NODES = [6, 8, 10, 12] as const;
export type Nodes = (typeof NODES)[number];

/** Edges to place. The round auto-cashes when the last one lands safe. */
export const EDGES = [4, 6, 8, 10, 12] as const;
export type Edges = (typeof EDGES)[number];

/** Targets are offered up to n + 2 edges. */
export const edgesAllowed = (nodes: number, edges: number) => edges <= nodes + 2;

/** The largest offered target for a node count. */
export const maxEdgesFor = (nodes: Nodes): Edges => [...EDGES].reverse().find((e) => edgesAllowed(nodes, e)) ?? EDGES[0];

export const VOLATILITY: Record<Volatility, { nodes: Nodes; edges: Edges }> = {
  low: { nodes: 12, edges: 6 },
  medium: { nodes: 10, edges: 8 },
  high: { nodes: 8, edges: 10 },
  extreme: { nodes: 6, edges: 8 },
};

export type Pair = readonly [number, number];

export interface Graph {
  n: number;
  /** Edges in the order they were placed, each as [low, high]. */
  edges: Pair[];
  /** Tone of each node: 0 light, 1 dark, −1 not joined to anything yet. */
  tone: number[];
  /** Component label of each node (the smallest node in its component). */
  comp: number[];
}

export const pairCount = (n: number) => (n * (n - 1)) / 2;

export function emptyGraph(n: number): Graph {
  return { n, edges: [], tone: Array(n).fill(-1), comp: Array.from({ length: n }, (_, i) => i) };
}

export const hasEdge = (g: Graph, u: number, v: number) => g.edges.some(([a, b]) => (a === u && b === v) || (a === v && b === u));

/** A new edge u–v closes an odd cycle exactly when u and v are already connected and share a tone. */
export const isFatal = (g: Graph, u: number, v: number) => u !== v && g.comp[u] === g.comp[v] && g.tone[u] === g.tone[v];

/** Every unjoined pair, in order (0,1), (0,2), …: the next edge is uniform over these. */
export function openPairs(g: Graph): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) if (!hasEdge(g, i, j)) out.push([i, j]);
  return out;
}

/** The open pairs that would close an odd cycle. */
export const fatalPairs = (g: Graph): Pair[] => openPairs(g).filter(([u, v]) => isFatal(g, u, v));

export interface Risk {
  fatal: number;
  open: number;
  /** Chance the next edge closes an odd cycle. */
  q: number;
}

export function risk(g: Graph): Risk {
  const open = pairCount(g.n) - g.edges.length;
  // Fatal pairs are never edges (every edge joins two tones), so count same-tone pairs within components.
  let fatal = 0;
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) if (isFatal(g, i, j)) fatal++;
  return { fatal, open, q: open > 0 ? fatal / open : 1 };
}

/** The graph after a safe edge u–v. Joining two components keeps the bigger one's tones and flips the other if needed. */
export function addEdge(g: Graph, u: number, v: number): Graph {
  if (isFatal(g, u, v)) throw new Error('addEdge: that edge closes an odd cycle');
  const tone = [...g.tone];
  const comp = [...g.comp];
  const members = (c: number) => comp.flatMap((x, i) => (x === c ? [i] : []));
  if (tone[u] < 0 && tone[v] < 0) {
    tone[u] = 0;
    tone[v] = 1;
  } else if (tone[u] < 0) tone[u] = 1 - tone[v];
  else if (tone[v] < 0) tone[v] = 1 - tone[u];
  else if (comp[u] !== comp[v] && tone[u] === tone[v]) {
    const [mu, mv] = [members(comp[u]), members(comp[v])];
    // Flip the smaller component (on a tie, the one not holding node 0's side of the ring).
    const flip = mu.length < mv.length || (mu.length === mv.length && comp[u] > comp[v]) ? mu : mv;
    for (const x of flip) tone[x] = 1 - tone[x];
  }
  if (comp[u] !== comp[v]) {
    const [keep, drop] = comp[u] < comp[v] ? [comp[u], comp[v]] : [comp[v], comp[u]];
    for (let i = 0; i < comp.length; i++) if (comp[i] === drop) comp[i] = keep;
  }
  const edge: Pair = u < v ? [u, v] : [v, u];
  return { n: g.n, edges: [...g.edges, edge], tone, comp };
}

/** Cash-out after surviving an edge that had bust chance q. */
export const afterSafeEdge = (cash: number, q: number) => cash / (1 - q);

/** A shortest path from u to v (BFS). With the edge v–u it closes the odd cycle that busts the round. */
export function oddCycle(g: Graph, u: number, v: number): number[] {
  const adj = adjacency(g.n, g.edges);
  const prev = Array(g.n).fill(-1);
  const seen = Array(g.n).fill(false);
  seen[u] = true;
  const queue = [u];
  while (queue.length) {
    const x = queue.shift()!;
    if (x === v) break;
    for (const y of adj[x]) if (!seen[y]) {
      seen[y] = true;
      prev[y] = x;
      queue.push(y);
    }
  }
  if (!seen[v]) return [];
  const path = [v];
  while (path[path.length - 1] !== u) path.push(prev[path[path.length - 1]]);
  return path.reverse();
}

function adjacency(n: number, edges: readonly Pair[]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

/** Brute force: 2-colour every component by BFS from scratch. For tests and the raw process. */
export function isBipartite(n: number, edges: readonly Pair[]): boolean {
  const adj = adjacency(n, edges);
  const col = Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (col[s] >= 0) continue;
    col[s] = 0;
    const stack = [s];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of adj[x]) {
        if (col[y] < 0) {
          col[y] = 1 - col[x];
          stack.push(y);
        } else if (col[y] === col[x]) return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Exact chances from tone-class profiles.

/** A component's two tone classes, larger first. A lone node is (1, 0). */
type Part = readonly [number, number];

const c2 = (k: number) => (k * (k - 1)) / 2;
const sortParts = (ps: Part[]) => ps.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
const part = (a: number, b: number): Part => (a >= b ? [a, b] : [b, a]);
const keyOf = (ps: readonly Part[], m: number) => ps.map(([a, b]) => a * 16 + b).join(',') + '|' + m;

/** The graph's profile: the tone-class sizes of every component. */
export function profile(g: Graph): Part[] {
  const sizes = new Map<number, [number, number]>();
  for (let i = 0; i < g.n; i++) {
    const s = sizes.get(g.comp[i]) ?? [0, 0];
    s[g.tone[i] === 1 ? 1 : 0]++;
    sizes.set(g.comp[i], s);
  }
  return sortParts([...sizes.values()].map(([a, b]) => part(a, b)));
}

interface Move {
  /** Open pairs that lead here. */
  weight: number;
  next: Part[];
}

/** From a profile with m edges: the fatal count, the open count, and where each safe pair leads. */
function moves(ps: readonly Part[], m: number, n: number): { fatal: number; open: number; safe: Move[] } {
  let fatal = 0;
  let cross = 0;
  for (const [a, b] of ps) {
    fatal += c2(a) + c2(b);
    cross += a * b;
  }
  const safe: Move[] = [];
  // Every edge joins two tones of one component, so the rest of those cross pairs are open and safe.
  if (cross - m > 0) safe.push({ weight: cross - m, next: [...ps] });
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const [ai, bi] = ps[i];
      const [aj, bj] = ps[j];
      const rest = ps.filter((_, k) => k !== i && k !== j);
      // a_i–a_j or b_i–b_j: j's tones flip. a_i–b_j or b_i–a_j: they line up.
      const flipped = ai * aj + bi * bj;
      const aligned = ai * bj + bi * aj;
      if (flipped > 0) safe.push({ weight: flipped, next: sortParts([...rest, part(ai + bj, bi + aj)]) });
      if (aligned > 0) safe.push({ weight: aligned, next: sortParts([...rest, part(ai + aj, bi + bj)]) });
    }
  }
  return { fatal, open: c2(n) - m, safe };
}

const lone = (n: number): Part[] => Array.from({ length: n }, () => [1, 0] as Part);

const finishMemo = new Map<string, Map<string, number>>();

/**
 * Exact chance of placing all E edges with no odd cycle, from profile ps with
 * m edges placed. A saturated graph (every open pair fatal) counts as
 * `saturated`: 1 for the game, where it auto-cashes, 0 for the bare theorem.
 */
function solveFinish(ps: readonly Part[], m: number, n: number, E: number, saturated: 0 | 1): number {
  if (m >= E) return 1;
  const tag = `${n}:${E}:${saturated}`;
  let memo = finishMemo.get(tag);
  if (!memo) finishMemo.set(tag, (memo = new Map()));
  const key = keyOf(ps, m);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const { fatal, open, safe } = moves(ps, m, n);
  let p: number;
  if (fatal >= open) p = saturated;
  else {
    p = 0;
    for (const s of safe) p += s.weight * solveFinish(s.next, m + 1, n, E, saturated);
    p /= open;
  }
  memo.set(key, p);
  return p;
}

/** Chance the round pays out if you never cash out: reach E edges, or a saturated graph first. Live, from graph g. */
export function finishChance(n: number, E: number, g?: Graph): number {
  return g ? solveFinish(profile(g), g.edges.length, n, E, 1) : solveFinish(lone(n), 0, n, E, 1);
}

/** Chance that E random edges on n nodes form a bipartite graph (the theorem's event), by the profile DP. */
export const reachChance = (n: number, E: number) => solveFinish(lone(n), 0, n, E, 0);

/** Chance the graph turns complete bipartite (every open pair fatal) before E edges: the round auto-cashes early. */
export const saturateChance = (n: number, E: number) => finishChance(n, E) - reachChance(n, E);

const maxMemo = new Map<string, number>();

/** The largest cash-out (over RTP) any run of safe edges can reach: the product of factors 1/(1 − q), maximised exactly. */
function solveMax(ps: readonly Part[], m: number, n: number, E: number): number {
  if (m >= E) return 1;
  const key = `${n}:${E}:` + keyOf(ps, m);
  const hit = maxMemo.get(key);
  if (hit !== undefined) return hit;
  const { fatal, open, safe } = moves(ps, m, n);
  let best = 1;
  if (fatal < open) {
    const factor = open / (open - fatal);
    for (const s of safe) best = Math.max(best, factor * solveMax(s.next, m + 1, n, E));
  }
  maxMemo.set(key, best);
  return best;
}

/** Exact upper bound on any payout with these settings. */
export const maxMultiplier = (n: number, E: number) => RTP * solveMax(lone(n), 0, n, E);

/**
 * Honest bound for the manifest: the largest maxMultiplier over every offered
 * setting (n = 10, E = 12 is the worst). The tests recompute it exactly.
 */
export const MAX_MULTIPLIER = 5_200;

// ---------------------------------------------------------------------------
// The closed form, exactly.

function binomBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

function polyMul(a: bigint[], b: bigint[]): bigint[] {
  const out: bigint[] = Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

const countsMemo: bigint[][] = [];

/**
 * B_n as a list by edge count: B_n[m] labelled bipartite graphs on n nodes
 * with m edges. From A = B² in EGFs, where A_n(y) = Σ_k C(n, k)(1 + y)^{k(n−k)}
 * counts 2-coloured graphs: B_n = (A_n − Σ_{0<k<n} C(n, k) B_k B_{n−k}) / 2.
 */
export function bipartiteCounts(n: number): bigint[] {
  if (countsMemo[n]) return countsMemo[n];
  if (n === 0) return (countsMemo[0] = [1n]);
  const size = Math.floor((n * n) / 4) + 1;
  const A: bigint[] = Array(size).fill(0n);
  for (let k = 0; k <= n; k++) {
    const e = k * (n - k);
    const ck = binomBig(n, k);
    for (let m = 0; m <= e; m++) A[m] += ck * binomBig(e, m);
  }
  for (let k = 1; k < n; k++) {
    const prod = polyMul(bipartiteCounts(k), bipartiteCounts(n - k));
    const ck = binomBig(n, k);
    for (let m = 0; m < prod.length && m < size; m++) A[m] -= ck * prod[m];
  }
  return (countsMemo[n] = A.map((x) => x / 2n));
}

/** Closed form: P(G(n, E) is bipartite) = B(n, E) / C(C(n, 2), E). */
export function bipartiteChance(n: number, E: number): number {
  const B = bipartiteCounts(n)[E] ?? 0n;
  return Number(B) / Number(binomBig(pairCount(n), E));
}

/** Volatility hint for the panel, by the chance to finish. */
export function volatilityOf(n: number, E: number): Volatility {
  const p = finishChance(n, E);
  return p >= 0.6 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}
