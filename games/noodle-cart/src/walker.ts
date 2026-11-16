// What the board shows about the cooks and the order tickets, read from the engine's own result.
// The engine turns whole reels wild (the walking cook, and in Dinner rush the extra cooks a cook symbol
// expands into) and only reports the columns, so the stops and strips are read here to find the tickets a
// cook stood on. In Dinner rush, a spin whose board shows a ticket is an order: the round already says
// whether it added a spin and what the next spin's multiplier is. Display only: nothing here changes a round.

import type { SlotRound, SlotSpec, SpinResult } from '@originals/slots';

export const SCATTER = 1;
export const WILD = 2;
export const WALKER_KEY = 'walking_wild.walker';
export const EXPANDED_KEY = 'expanding_wild.expandedReels';

type Strips = number[][];

/** Rows of column `col` that showed `scatter` on the raw reels (before a cook covered them), given the spin's stops. */
export function coveredRows(strips: Strips, stops: number[], col: number, rows: number, scatter = SCATTER): number[] {
  const strip = strips[col];
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    const L = strip.length;
    if (strip[(((stops[col] + r) % L) + L) % L] === scatter) out.push(r);
  }
  return out;
}

/** The order a Dinner rush spin took: its first visible ticket, the spins it added and the next spin's multiplier. */
export interface Order {
  col: number;
  row: number;
  addedSpins: number;
  /** The next spin's multiplier, or null when no spin follows (the round ended). */
  nextMultiplier: number | null;
}

interface SpinNote {
  /** Cook columns: the walker, and the extra cooks of Dinner rush. */
  cooks: Map<number, 'walker' | 'extra'>;
  /** Rows of each cook column that held a ticket before the cook covered it. */
  covered: Map<number, number[]>;
  feature: boolean;
  order: Order | null;
}

/** Notes by the decor object the UI hands back to `renderOverlay`. */
const notes = new WeakMap<object, SpinNote>();

export function noteSpin(spec: SlotSpec, result: SpinResult, feature = false, order: Order | null = null): void {
  const strips = (spec as unknown as { board_law: { reel_sets: { strips: Strips }[] } }).board_law.reel_sets[result.set ?? 0].strips;
  const cooks = new Map<number, 'walker' | 'extra'>();
  const ex = result.decor[EXPANDED_KEY];
  if (Array.isArray(ex)) for (const c of ex) if (typeof c === 'number') cooks.set(c, 'extra');
  const w = result.decor[WALKER_KEY];
  if (typeof w === 'number') cooks.set(w, 'walker');
  const covered = new Map<number, number[]>();
  for (const c of cooks.keys()) covered.set(c, coveredRows(strips, result.stops, c, result.finalBoard[c].length));
  notes.set(result.decor, { cooks, covered, feature, order });
}

/** The first visible ticket on a board (column-major), or null. */
export function firstTicket(board: number[][]): [number, number] | null {
  for (let c = 0; c < board.length; c++) for (let r = 0; r < board[c].length; r++) if (board[c][r] === SCATTER) return [c, r];
  return null;
}

export function noteRound(spec: SlotSpec, featureSpec: SlotSpec, round: SlotRound): void {
  noteSpin(spec, round.base);
  const spins = round.feature?.spins ?? [];
  spins.forEach((s, i) => {
    const t = firstTicket(s.result.steps[0]?.board ?? s.result.finalBoard);
    // A ticket on a rush spin is a new order: the round records the spins it added, and the next spin's multiplier.
    const next = spins[i + 1]?.multiplier ?? null;
    const order = t ? { col: t[0], row: t[1], addedSpins: s.retrigger, nextMultiplier: next } : null;
    noteSpin(featureSpec, s.result, true, order);
  });
}

const noteOf = (decor: Record<string, unknown> | undefined) => (decor ? notes.get(decor) : undefined);

/** True when this cell is a cook standing where a ticket was. */
export function holdsTicket(decor: Record<string, unknown> | undefined, col: number, row: number, symbol: number): boolean {
  if (symbol !== WILD) return false;
  return noteOf(decor)?.covered.get(col)?.includes(row) ?? false;
}

/** The cook on this cell's reel ('walker' or 'extra'), or null. */
export function cookAt(decor: Record<string, unknown> | undefined, col: number, symbol: number): 'walker' | 'extra' | null {
  if (symbol !== WILD) return null;
  return noteOf(decor)?.cooks.get(col) ?? null;
}

/** The order shown on this ticket cell (Dinner rush only), or null. */
export function orderAt(decor: Record<string, unknown> | undefined, col: number, row: number, symbol: number): Order | null {
  if (symbol !== SCATTER) return null;
  const o = noteOf(decor)?.order;
  return o && o.col === col && o.row === row ? o : null;
}

/** True for any ticket on a Dinner rush spin that took an order (the order's other tickets get its frame too). */
export function inOrder(decor: Record<string, unknown> | undefined, symbol: number): boolean {
  return symbol === SCATTER && !!noteOf(decor)?.order;
}

/** True when the spin is a Dinner rush spin. */
export const isRushSpin = (decor: Record<string, unknown> | undefined) => !!noteOf(decor)?.feature;
