// Maze: a ball wanders a maze at random; the green exit wins, a red trap loses.
//
// Each move the ball rolls to a uniformly random open neighbour (through the
// gaps in the walls). Let h(c) be the chance of reaching the exit before any
// trap from cell c. It is the unique solution of the discrete Dirichlet problem
//
//   h(exit) = 1,   h(trap) = 0,   h(c) = mean of h over c's open neighbours,
//
// i.e. h is the harmonic function on the maze graph with those boundary
// values (it is also the voltage at c when the exit is held at 1 V and the
// traps at 0 V and every gap is a 1 Ω resistor). We solve the linear system
// once per maze by Gaussian elimination with partial pivoting (machine
// precision; the tests check it against Gauss–Seidel and a simulation).
//
// The board shades every cell by h, so the whole odds map is visible, and the
// cell under the ball is the live chance. The neighbours' values are the odds
// each possible next move would leave you with; by the equation above they
// average to the current chance.
//
// Pricing (fixed prize): reaching the exit pays prize = RTP / h(start), and
// cashing out with the ball on cell c pays prize × h(c). h(ball) is the
// conditional probability of the same event as the round goes on, so it is a
// martingale, and by optional stopping every cash-out rule (after any number
// of moves, Auto targets included) returns exactly RTP. Choosing the start
// cell changes the prize and the risk, never the return.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Moves per roll (a Manual checkpoint comes after each roll; Step plays one move). */
export const ROLL = 3;

// ---------- Mazes ----------

export type MazeId = 'garden' | 'labyrinth' | 'catacomb';
export const MAZE_IDS: MazeId[] = ['garden', 'labyrinth', 'catacomb'];

// Cells sit at odd (column, row) characters; '-' and '|' between two cells are
// walls, a space is a gap. 'E' is the exit and 'T' a trap.
const LAYOUTS: Record<MazeId, { name: string; short: string; rows: string[]; presets: number[] }> = {
  garden: {
    name: 'Garden 5×5',
    short: 'Garden',
    presets: [0.72, 0.44, 0.2, 0.085],
    rows: [
      '+-+-+-+-+-+', //
      '|         |',
      '+ +-+-+-+ +',
      '| |    E  |',
      '+ + + +-+-+',
      '|   |     |',
      '+ + +-+-+ +',
      '|    T    |',
      '+ + + +-+ +',
      '|   |     |',
      '+-+-+-+-+-+',
    ],
  },
  labyrinth: {
    name: 'Labyrinth 6×6',
    short: 'Labyrinth',
    presets: [0.55, 0.3, 0.125, 0.06],
    rows: [
      '+-+-+-+-+-+-+', //
      '|           |',
      '+ + +-+ +-+ +',
      '|   |     | |',
      '+-+ + +-+ + +',
      '|  T    |   |',
      '+ +-+-+ + +-+',
      '| |         |',
      '+ + +-+-+-+ +',
      '| |         |',
      '+ +-+ + +-+ +',
      '|      E    |',
      '+-+-+-+-+-+-+',
    ],
  },
  catacomb: {
    name: 'Catacomb 7×7',
    short: 'Catacomb',
    presets: [0.4, 0.15, 0.06, 0.024],
    rows: [
      '+-+-+-+-+-+-+-+', //
      '|T      |     |',
      '+ + +-+ + +-+ +',
      '| |   | |     |',
      '+ +-+ + +-+ + +',
      '|   | |    T  |',
      '+-+ + +-+-+ + +',
      '|   |   |   | |',
      '+ + +-+ + + + +',
      '|   |       | |',
      '+ + + + +-+ + +',
      '| | |     |   |',
      '+ + + + + +-+ +',
      '|    E        |',
      '+-+-+-+-+-+-+-+',
    ],
  },
};

/** Start cells may be picked only where the odds are between these (keeps prizes between ~1.04× and 99×). */
export const MIN_START = 0.01;
export const MAX_START = 0.95;

export interface Maze {
  id: MazeId;
  name: string;
  short: string;
  w: number;
  h: number;
  /** Open neighbours of each cell (up, right, down, left order). */
  nbrs: number[][];
  exit: number;
  traps: number[];
  /** h(c): the chance of reaching the exit before a trap from each cell. */
  odds: Float64Array;
  /** Expected moves until the ball reaches the exit or a trap, from each cell. */
  moves: Float64Array;
  /** Shortest-path distance (in moves) to the exit and to the nearest trap. */
  toExit: number[];
  toTrap: number[];
  /** The four start presets (cells), from safest to wildest. */
  presets: number[];
}

/**
 * Solves A x = b for every right-hand side column by Gaussian elimination with
 * partial pivoting. A is n×n, B is n×k (row-major arrays of rows).
 */
export function gaussSolve(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  const k = B[0]?.length ?? 0;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || M[r][c] === 0) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n + k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row.slice(n).map((v) => v / M[i][i]));
}

/**
 * The harmonic function with the given absorbing values (cell → value), and
 * the expected number of moves to absorption, from every cell.
 */
export function harmonic(nbrs: number[][], fixed: Map<number, number>): { value: Float64Array; time: Float64Array } {
  const n = nbrs.length;
  const free = [...Array(n).keys()].filter((c) => !fixed.has(c));
  const at = new Map(free.map((c, k) => [c, k]));
  const A = free.map(() => new Array<number>(free.length).fill(0));
  const B = free.map(() => [0, 1]);
  free.forEach((c, k) => {
    A[k][k] = 1;
    const d = nbrs[c].length;
    for (const v of nbrs[c]) {
      const f = fixed.get(v);
      if (f !== undefined) B[k][0] += f / d;
      else A[k][at.get(v)!] -= 1 / d;
    }
  });
  const x = free.length ? gaussSolve(A, B) : [];
  const value = new Float64Array(n);
  const time = new Float64Array(n);
  fixed.forEach((v, c) => (value[c] = v));
  free.forEach((c, k) => {
    value[c] = x[k][0];
    time[c] = x[k][1];
  });
  return { value, time };
}

function bfs(nbrs: number[][], from: number[], blocked: Set<number>): number[] {
  const d = new Array<number>(nbrs.length).fill(Infinity);
  const queue = [...from];
  for (const s of from) d[s] = 0;
  for (let k = 0; k < queue.length; k++) {
    const u = queue[k];
    if (blocked.has(u) && d[u] > 0) continue;
    for (const v of nbrs[u]) if (d[v] === Infinity) (d[v] = d[u] + 1), queue.push(v);
  }
  return d;
}

function buildMaze(id: MazeId): Maze {
  const { name, short, rows, presets: targets } = LAYOUTS[id];
  const h = (rows.length - 1) / 2;
  const w = (rows[0].length - 1) / 2;
  let exit = -1;
  const traps: number[] = [];
  const nbrs: number[][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cx = 2 * x + 1;
      const cy = 2 * y + 1;
      const ch = rows[cy][cx];
      if (ch === 'E') exit = i;
      if (ch === 'T') traps.push(i);
      const out: number[] = [];
      if (y > 0 && rows[cy - 1][cx] === ' ') out.push(i - w);
      if (x < w - 1 && rows[cy][cx + 1] === ' ') out.push(i + 1);
      if (y < h - 1 && rows[cy + 1][cx] === ' ') out.push(i + w);
      if (x > 0 && rows[cy][cx - 1] === ' ') out.push(i - 1);
      nbrs.push(out);
    }
  const fixed = new Map<number, number>([[exit, 1], ...traps.map((t) => [t, 0] as [number, number])]);
  const { value: odds, time: moves } = harmonic(nbrs, fixed);
  const ends = new Set([exit, ...traps]);
  const toExit = bfs(nbrs, [exit], ends);
  const toTrap = bfs(nbrs, traps, ends);
  const m: Maze = { id, name, short, w, h, nbrs, exit, traps, odds, moves, toExit, toTrap, presets: [] };
  const cells = [...Array(w * h).keys()].filter((c) => selectable(m, c));
  m.presets = targets.map((tg) => cells.reduce((best, c) => (Math.abs(Math.log(odds[c] / tg)) < Math.abs(Math.log(odds[best] / tg)) ? c : best), cells[0]));
  return m;
}

const cache = new Map<MazeId, Maze>();
export function maze(id: MazeId): Maze {
  let m = cache.get(id);
  if (!m) cache.set(id, (m = buildMaze(id)));
  return m;
}

/** Whether the ball may start on this cell. */
export function selectable(m: Maze, c: number): boolean {
  return c !== m.exit && !m.traps.includes(c) && m.odds[c] >= MIN_START && m.odds[c] <= MAX_START;
}

export const isTrap = (m: Maze, c: number) => m.traps.includes(c);
export const isEnd = (m: Maze, c: number) => c === m.exit || m.traps.includes(c);

// ---------- Settings, prices ----------

export interface Settings {
  maze: MazeId;
  start: number;
}

export const startChance = (s: Settings) => maze(s.maze).odds[s.start];
export const prizeFor = (s: Settings) => RTP / startChance(s);

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.4 ? 'low' : p > 0.15 ? 'medium' : p > 0.05 ? 'high' : 'extreme';
}

/** Every setting a player can pick: each maze with each allowed start cell. */
export const ALL_SETTINGS: Settings[] = MAZE_IDS.flatMap((id) => {
  const m = maze(id);
  return [...Array(m.w * m.h).keys()].filter((c) => selectable(m, c)).map((start) => ({ maze: id, start }));
});

/**
 * Reaching the exit pays the prize and any cash-out pays prize × h ≤ prize, so
 * the largest prize over all allowed starts bounds every payout: 82.3×
 * (Catacomb, the 1.2% cell beside the second trap). A constant, so importing
 * the manifest solves nothing; the tests check it against every setting.
 */
export const MAX_MULTIPLIER = 83;

// ---------- Moves ----------

export type End = 'exit' | 'trap' | null;

export const endOf = (m: Maze, c: number): End => (c === m.exit ? 'exit' : m.traps.includes(c) ? 'trap' : null);

/** One move: the ball rolls to a uniformly random open neighbour. */
export function move(m: Maze, at: number, rng: Rng): number {
  const nb = m.nbrs[at];
  return nb[rng.int(nb.length)];
}

/** Plays up to `n` moves, stopping early at the exit or a trap. Returns the cells visited (not including `at`). */
export function roll(m: Maze, at: number, n: number, rng: Rng): number[] {
  const path: number[] = [];
  let c = at;
  for (let k = 0; k < n && !isEnd(m, c); k++) path.push((c = move(m, c, rng)));
  return path;
}

export interface MoveOdds {
  cell: number;
  /** The chance of escaping if the ball rolls here next. */
  p: number;
}

/** The ball's possible next moves, each equally likely, with the odds each would leave. */
export const moveOdds = (m: Maze, at: number): MoveOdds[] => m.nbrs[at].map((cell) => ({ cell, p: m.odds[cell] }));

/**
 * Exact chances that the next `n` moves end the round at the exit or in a
 * trap (by pushing the ball's distribution forward n moves).
 */
export function rollOutlook(m: Maze, at: number, n: number): { exit: number; trap: number } {
  let dist = new Float64Array(m.w * m.h);
  dist[at] = 1;
  let exit = 0;
  let trap = 0;
  for (let k = 0; k < n; k++) {
    const next = new Float64Array(dist.length);
    dist.forEach((q, c) => {
      if (q === 0) return;
      const nb = m.nbrs[c];
      for (const v of nb) {
        const share = q / nb.length;
        if (v === m.exit) exit += share;
        else if (m.traps.includes(v)) trap += share;
        else next[v] += share;
      }
    });
    dist = next;
  }
  return { exit, trap };
}

// ---------- Auto ----------

/** Auto cash-out targets (null = play to the end). */
export const AUTO_TARGETS: (number | null)[] = [null, 1.5, 2, 3, 5, 10, 25];

/** Auto's stopping rule, checked after every move: cash out once the cash-out reaches the target. */
export const autoStops = (cash: number, target: number | null) => target !== null && cash >= target;

const autoCache = new Map<string, number>();

/**
 * Exact chance that an Auto round with this target pays at least the target:
 * the same harmonic problem with every cell where the rule fires made an
 * absorbing "success" cell.
 */
export function autoChance(s: Settings, target: number | null): number {
  if (target === null) return startChance(s);
  const key = `${s.maze}/${s.start}/${target}`;
  const hit = autoCache.get(key);
  if (hit !== undefined) return hit;
  const m = maze(s.maze);
  const prize = prizeFor(s);
  const fixed = new Map<number, number>();
  m.odds.forEach((h, c) => {
    if (m.traps.includes(c)) fixed.set(c, 0);
    else if (c === m.exit || autoStops(prize * h, target)) fixed.set(c, 1);
  });
  const p = fixed.has(s.start) ? fixed.get(s.start)! : harmonic(m.nbrs, fixed).value[s.start];
  autoCache.set(key, p);
  return p;
}
