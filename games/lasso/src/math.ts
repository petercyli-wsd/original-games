// Lasso: a simple random walk on a square field of cells with one blocked
// cell in the middle, the pole. Each step moves to one of the open
// neighbouring cells, chosen uniformly (walls and the pole are never
// entered). After T steps the rope is pulled back to the start the short way
// round. You win if the closed loop goes round the pole at least k times.
//
// The theorem: winding number. On the punctured lattice the winding number
// of a loop round the pole is the signed count of its crossings of any cut
// joining the pole to the outer wall. We use the seam along the cell
// boundary y = −½, from the pole's corner to the left wall: a step from
// (x, 0) down to (x, −1) with x < 0 is +1 (anticlockwise), the step back up
// is −1. The walk starts at (1, 0), right of the pole, so the seam is
// opposite the start, and the net crossing count w is exactly the winding
// number of the walk closed by the shorter arc back to the start:
//
//     w = ⌈θ/2π − ½⌉,   θ = the total angle swept round the pole
//
// (tie rule: cells on the ray y = 0, x < 0 sit at θ = π mod 2π and belong to
// the upper side, so θ = π rounds to 0 and θ = −π to −1).
//
// Live odds, exactly. With t steps left, the chance of finishing with
// |w| ≥ k depends only on (cell, w, t):
//
//     P(c, w, 0) = [|w| ≥ k]
//     P(c, w, t) = (1/deg c) Σ_{n ~ c} P(n, w + δ(c→n), t − 1).
//
// That is a finite dynamic programme in rationals' clothing: no Monte
// Carlo. The w axis is stored on [−W, W] with W = 16; from the start no walk
// of ≤ 60 steps gets past |w| = 8 (the first crossing takes 4 steps, every
// further net crossing a full lap of ≥ 8), and an edge effect at |w| = W
// needs > 100 steps to reach |w| ≤ 2, so every reachable value is exact.
// P is exactly 0 or 1 when the outcome is settled (sums of 0s and 1s divided
// by the degree), which ends the round at once.
//
// Fairness. The prize is RTP / P(start, 0, T) and the cash-out is
// prize × P(now). The recursion is the one-step expectation, so the
// cash-out is a martingale starting at RTP: every stopping rule, including
// the checkpoints every BURST steps, returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Steps in a walk. */
export const STEPS = [10, 20, 40, 60] as const;
export type Steps = (typeof STEPS)[number];

/** Half-width R of the field: (2R+1)² cells around the pole. */
export const FIELDS = [2, 3, 4] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = { 2: '5×5', 3: '7×7', 4: '9×9' };

/** Loops needed round the pole. */
export const LAPS = [1, 2] as const;
export type Laps = (typeof LAPS)[number];

/** Steps walked between checkpoints. */
export const BURST = 5;

/** Two loops need room: the target is offered with 40 steps or more. */
export const allowed = (steps: Steps, laps: Laps) => laps === 1 || steps >= 40;

export interface Settings {
  field: Field;
  steps: Steps;
  laps: Laps;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { field: 2, steps: 60, laps: 1 },
  medium: { field: 3, steps: 40, laps: 1 },
  high: { field: 4, steps: 20, laps: 1 },
  extreme: { field: 3, steps: 60, laps: 2 },
};

export interface Cell {
  x: number;
  y: number;
}

export const START: Cell = { x: 1, y: 0 };

export const isOpen = (R: number, x: number, y: number) => Math.abs(x) <= R && Math.abs(y) <= R && (x !== 0 || y !== 0);

/** Seam crossing of a step: +1 down across y = −½ left of the pole, −1 back up. */
export function crossing(from: Cell, to: Cell): number {
  if (from.x >= 0 || from.x !== to.x) return 0;
  if (from.y === 0 && to.y === -1) return 1;
  if (from.y === -1 && to.y === 0) return -1;
  return 0;
}

const DIRS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** The open cells a walker at c can step to, each equally likely. */
export function neighbours(R: number, c: Cell): Cell[] {
  return DIRS.map((d) => ({ x: c.x + d.x, y: c.y + d.y })).filter((n) => isOpen(R, n.x, n.y));
}

/** Net seam crossings (the winding number) of a path. */
export function windingOf(path: readonly Cell[]): number {
  let w = 0;
  for (let i = 1; i < path.length; i++) w += crossing(path[i - 1], path[i]);
  return w;
}

export const W = 16;

class Table {
  readonly side: number;
  readonly cells: Cell[] = [];
  readonly index: Int16Array;
  private readonly nbr: { to: number; d: number }[][];
  private readonly layers: Float64Array[] = [];

  constructor(
    readonly R: number,
    readonly k: number,
    readonly w = W,
  ) {
    this.side = 2 * R + 1;
    this.index = new Int16Array(this.side * this.side).fill(-1);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++)
        if (isOpen(R, x, y)) {
          this.index[(y + R) * this.side + x + R] = this.cells.length;
          this.cells.push({ x, y });
        }
    this.nbr = this.cells.map((c) => neighbours(R, c).map((n) => ({ to: this.idx(n), d: crossing(c, n) })));
    const nw = 2 * w + 1;
    const base = new Float64Array(this.cells.length * nw);
    for (let c = 0; c < this.cells.length; c++) for (let v = -w; v <= w; v++) base[c * nw + v + w] = Math.abs(v) >= k ? 1 : 0;
    this.layers.push(base);
  }

  idx(c: Cell) {
    return this.index[(c.y + this.R) * this.side + c.x + this.R];
  }

  layer(t: number): Float64Array {
    const w = this.w;
    const nw = 2 * w + 1;
    while (this.layers.length <= t) {
      const P = this.layers[this.layers.length - 1];
      const Q = new Float64Array(P.length);
      for (let c = 0; c < this.cells.length; c++) {
        const nb = this.nbr[c];
        for (let v = -w; v <= w; v++) {
          let s = 0;
          for (const { to, d } of nb) s += P[to * nw + Math.max(-w, Math.min(w, v + d)) + w];
          Q[c * nw + v + w] = s / nb.length;
        }
      }
      this.layers.push(Q);
    }
    return this.layers[t];
  }

  chance(c: Cell, v: number, t: number): number {
    const w = this.w;
    return this.layer(t)[this.idx(c) * (2 * w + 1) + Math.max(-w, Math.min(w, v)) + w];
  }
}

const tables = new Map<string, Table>();
function table(R: number, k: number): Table {
  const key = `${R}:${k}`;
  let t = tables.get(key);
  if (!t) tables.set(key, (t = new Table(R, k)));
  return t;
}

/** Test hook: a fresh table with a different w range. */
export const tableWith = (R: number, k: number, w: number) => new Table(R, k, w);

/** Exact chance of finishing with |w| ≥ laps, from cell c with winding w and `left` steps to go. */
export const chance = (field: number, laps: number, c: Cell, w: number, left: number) => table(field, laps).chance(c, w, left);

/** The chance for every open cell (same winding, same steps left): the board's shading. */
export function chanceField(field: number, laps: number, w: number, left: number): { cell: Cell; p: number }[] {
  const tb = table(field, laps);
  return tb.cells.map((cell) => ({ cell, p: tb.chance(cell, w, left) }));
}

/** Chance to win at the start of a round. */
export const winChance = ({ field, steps, laps }: Settings) => chance(field, laps, START, 0, steps);

export const prizeFor = (s: Settings) => RTP / winChance(s);

export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s);
  return p > 0.25 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** Max payout: the prize of the rarest allowed setting (9×9, 40 steps, 2 loops: P ≈ 0.0237%, 4183×). Checked in tests. */
export const MAX_MULTIPLIER = 4200;

export interface WalkResult {
  /** The cells walked, not including the starting cell. */
  cells: Cell[];
  w: number;
  left: number;
  /** Exact chance after the walk. 0 or 1 ends the round. */
  p: number;
}

/**
 * Walks up to `max` steps from `from`, stopping early once the outcome is
 * settled (chance exactly 0 or 1). `u` supplies uniform numbers in [0, 1).
 */
export function walk(s: Settings, from: Cell, w: number, left: number, max: number, u: () => number): WalkResult {
  const cells: Cell[] = [];
  let at = from;
  let p = chance(s.field, s.laps, at, w, left);
  for (let i = 0; i < max && left > 0 && p > 0 && p < 1; i++) {
    const nb = neighbours(s.field, at);
    const next = nb[Math.min(nb.length - 1, Math.floor(u() * nb.length))];
    w += crossing(at, next);
    left--;
    at = next;
    cells.push(next);
    p = chance(s.field, s.laps, at, w, left);
  }
  return { cells, w, left, p };
}

/** Total angle swept round the pole (radians), for the rope gauge. */
export function sweepOf(path: readonly Cell[]): number {
  let th = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    let d = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    th += d;
  }
  return th;
}
