// Ramsey: the edges of a complete graph K_n (n dots on a polygon, every pair
// joined) are coloured one at a time, each with one of c colours chosen
// uniformly at random. The round is lost the moment three edges of one colour
// form a triangle.
//
// The risk of an open edge uv is local and exact. Colour k closes a
// one-colour triangle exactly when some third dot w already has uw and vw
// both coloured k. So the bust chance of uv is f/c, where f is the number of
// colours that already meet across uv; with 2 colours that is 0, 1/2 or 1,
// with 3 colours 0, 1/3, 2/3 or 1. Each open edge draws this as a disc cut
// into c slices, the fatal slices red: the red share of the disc is the risk.
//
// The theorem. Ramsey's R(3,3) = 6: every 2-colouring of the 15 edges of K6
// contains a one-colour triangle. So on the hexagon board the round can never
// fill the graph: it must end in a bust, a cash-out or a lock (every open edge
// would close a triangle in every colour). K5 is the largest board that can
// be 2-coloured cleanly, and only by the two pentagons (a 5-cycle and its
// pentagram complement): 12 of the 2^10 colourings. With 3 colours,
// R(3,3,3) = 17, so the octagon is capped by a max win instead.
//
// Pricing (per-step fair factor). Surviving an edge with bust chance q
// multiplies the cash-out by 1/(1 − q), so every pick is a fair bet:
// (1 − q) · V/(1 − q) = V. The cash-out is a martingale that starts at RTP,
// and by optional stopping every strategy (which edge, when to stop) returns
// exactly RTP. Choosing an edge never changes the cash-out at the moment of
// choosing; it only changes the volatility of the next step. Edges with q = 1
// are never offered (locked); when only locked edges remain the round
// auto-cashes. On the octagon an edge whose win would pass MAX_WIN is not
// offered either, and the round auto-cashes once no risky edge can ever be
// taken again. Both are stopping rules, so RTP is unchanged.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_WIN = 10_000;

export type BoardId = 'k4' | 'k5' | 'k6' | 'k8';

export interface BoardSpec {
  id: BoardId;
  /** Dots on the polygon. */
  n: number;
  colours: number;
  level: Volatility;
  /**
   * Most risky edges any round can survive before the board locks (exhaustive
   * search, checked in the tests), or null when the max-win cap binds first.
   */
  maxRisky: number | null;
}

export const BOARDS: Record<BoardId, BoardSpec> = {
  k4: { id: 'k4', n: 4, colours: 2, level: 'low', maxRisky: 3 },
  k5: { id: 'k5', n: 5, colours: 2, level: 'medium', maxRisky: 6 },
  k6: { id: 'k6', n: 6, colours: 2, level: 'high', maxRisky: 9 },
  k8: { id: 'k8', n: 8, colours: 3, level: 'extreme', maxRisky: null },
};
export const BOARD_IDS = Object.keys(BOARDS) as BoardId[];

export const VOLATILITY: Record<Volatility, BoardId> = { low: 'k4', medium: 'k5', high: 'k6', extreme: 'k8' };

// ---------------------------------------------------------------- the graph

export interface Graph {
  n: number;
  /** Edges [u, v] with u < v, in lexicographic order. */
  edges: [number, number][];
  /** Edge index of the pair {u, v}. */
  id: number[][];
  /** For edge k = uv: one entry per third dot w, with w and the edges uw, vw. */
  thirds: { w: number; a: number; b: number }[][];
  /** Every triangle, as three edge indices. */
  triangles: [number, number, number][];
}

const graphs = new Map<number, Graph>();

export function graph(n: number): Graph {
  const hit = graphs.get(n);
  if (hit) return hit;
  const edges: [number, number][] = [];
  const id = Array.from({ length: n }, () => Array<number>(n).fill(-1));
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      id[u][v] = id[v][u] = edges.length;
      edges.push([u, v]);
    }
  }
  const thirds = edges.map(([u, v]) =>
    Array.from({ length: n }, (_, w) => w)
      .filter((w) => w !== u && w !== v)
      .map((w) => ({ w, a: id[u][w], b: id[v][w] })),
  );
  const triangles: [number, number, number][] = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) triangles.push([id[a][b], id[a][c], id[b][c]]);
  const g = { n, edges, id, thirds, triangles };
  graphs.set(n, g);
  return g;
}

/** A colouring: one entry per edge, −1 while the edge is open, else its colour 0..c−1. */
export type Colouring = readonly number[];

export const emptyColouring = (n: number): number[] => Array<number>((n * (n - 1)) / 2).fill(-1);

export const popcount = (x: number) => {
  let s = 0;
  for (; x; x &= x - 1) s++;
  return s;
};

/** Bit k is set when colouring open edge `edge` with colour k would close a one-colour triangle. */
export function fatalMask(g: Graph, col: Colouring, edge: number): number {
  let mask = 0;
  for (const { a, b } of g.thirds[edge]) {
    const x = col[a];
    if (x >= 0 && x === col[b]) mask |= 1 << x;
  }
  return mask;
}

/** The third dots w that would close a triangle of colour `colour` with edge `edge`. */
export function closers(g: Graph, col: Colouring, edge: number, colour: number): number[] {
  return g.thirds[edge].filter(({ a, b }) => col[a] === colour && col[b] === colour).map(({ w }) => w);
}

/** Brute force: the first one-colour triangle in the colouring, as three dots, or null. */
export function monoTriangle(g: Graph, col: Colouring): [number, number, number] | null {
  for (const [x, y, z] of g.triangles) {
    if (col[x] >= 0 && col[x] === col[y] && col[x] === col[z]) {
      const [a, b] = g.edges[x];
      return [a, b, g.edges[y][1]];
    }
  }
  return null;
}

// ---------------------------------------------------------------- odds and pricing

export type EdgeState = 'coloured' | 'free' | 'risky' | 'locked' | 'capped';

export interface EdgeOdds {
  edge: number;
  state: EdgeState;
  /** Fatal colours (bit mask). 0 for coloured edges. */
  mask: number;
  /** Bust chance: fatal colours / c. */
  q: number;
  /** Cash-out multiplier if it lands safe: 1 / (1 − q). */
  factor: number;
}

/** Relative slack for the cap comparison: a pick is offered when cash · factor ≤ MAX_WIN · (1 + 1e-12). */
const CAP_SLACK = 1 + 1e-12;

export function edgeOdds(board: BoardSpec, col: Colouring, cash: number): EdgeOdds[] {
  const g = graph(board.n);
  const c = board.colours;
  return g.edges.map((_, edge) => {
    if (col[edge] >= 0) return { edge, state: 'coloured', mask: 0, q: 0, factor: 1 };
    const mask = fatalMask(g, col, edge);
    const f = popcount(mask);
    const q = f / c;
    if (f >= c) return { edge, state: 'locked', mask, q: 1, factor: Infinity };
    const factor = c / (c - f);
    if (cash * factor > MAX_WIN * CAP_SLACK) return { edge, state: 'capped', mask, q, factor };
    return { edge, state: f === 0 ? 'free' : 'risky', mask, q, factor };
  });
}

export const isOffered = (o: EdgeOdds) => o.state === 'free' || o.state === 'risky';

/** Cash-out after surviving a pick that had bust chance q. */
export const afterSafePick = (cash: number, q: number) => cash / (1 - q);

export type Ending = 'full' | 'locked' | 'cap';

/**
 * Why the round must stop here, or null if a pick can still be offered.
 * `cap`: no risky edge can ever be taken again without passing MAX_WIN (the
 * cheapest risky factor is c/(c−1)), or every offered edge is capped.
 */
export function ending(board: BoardSpec, col: Colouring, cash: number): Ending | null {
  if (col.every((x) => x >= 0)) return 'full';
  const c = board.colours;
  if ((cash * c) / (c - 1) > MAX_WIN * CAP_SLACK) return 'cap';
  const odds = edgeOdds(board, col, cash);
  if (odds.some(isOffered)) return null;
  return odds.some((o) => o.state === 'capped') ? 'cap' : 'locked';
}

/** Exact chance that the Random edge button (uniform over offered edges) lands safe. */
export function randomEdgeSafe(odds: readonly EdgeOdds[]): number {
  const offered = odds.filter(isOffered);
  if (offered.length === 0) return 1;
  return offered.reduce((s, o) => s + (1 - o.q), 0) / offered.length;
}

/** The largest payout this board can produce: RTP · 2^maxRisky (2 colours) or the cap. */
export function maxWin(board: BoardSpec): number {
  return board.maxRisky === null ? MAX_WIN : RTP * (board.colours / (board.colours - 1)) ** board.maxRisky;
}

/** An honest bound on every payout: no board pays above MAX_WIN. */
export const MAX_MULTIPLIER = Math.max(MAX_WIN, ...BOARD_IDS.map((id) => maxWin(BOARDS[id])));

// ---------------------------------------------------------------- the risk disc

export interface Sector {
  colour: number;
  /** Start and end, in turns clockwise from the top. */
  start: number;
  end: number;
  fatal: boolean;
}

/** The disc on an open edge: one equal slice per colour, the fatal ones red. Red share = q. */
export function discSectors(colours: number, mask: number): Sector[] {
  return Array.from({ length: colours }, (_, k) => ({
    colour: k,
    start: k / colours,
    end: (k + 1) / colours,
    fatal: ((mask >> k) & 1) === 1,
  }));
}

/** Where the spinner on the disc stops for colour k (u in [0, 1) only places it within the slice). */
export const landingTurn = (colours: number, colour: number, u: number) => (colour + 0.18 + 0.64 * u) / colours;

// ---------------------------------------------------------------- exact counts (theorem checks)

/** Number of c-colourings of K_n with no one-colour triangle, by backtracking. */
export function countTriangleFree(n: number, c: number): number {
  const g = graph(n);
  const col = emptyColouring(n);
  let total = 0;
  const rec = (edge: number) => {
    if (edge === col.length) {
      total++;
      return;
    }
    // Edges are lexicographic, so every triangle closes at its last edge.
    const mask = fatalMask(g, col, edge);
    for (let k = 0; k < c; k++) {
      if ((mask >> k) & 1) continue;
      col[edge] = k;
      rec(edge + 1);
    }
    col[edge] = -1;
  };
  rec(0);
  return total;
}
