// Which rows of the walker's reel held an order ticket before the cook covered them.
// The engine turns the whole reel wild and only reports the column (decor `walking_wild.walker`),
// so the stops and strips are read here to find the tickets he stood on.

import type { SlotRound, SlotSpec, SpinResult } from '@originals/slots';

export const SCATTER = 1;
export const WALKER_KEY = 'walking_wild.walker';

type Strips = number[][];

/** Rows of column `col` that showed `scatter` on the raw reels (before the walk), given the spin's stops. */
export function coveredRows(strips: Strips, stops: number[], col: number, rows: number, scatter = SCATTER): number[] {
  const strip = strips[col];
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    const L = strip.length;
    if (strip[(((stops[col] + r) % L) + L) % L] === scatter) out.push(r);
  }
  return out;
}

/** Covered rows by the decor object the UI hands back to `renderOverlay`. */
const covered = new WeakMap<object, number[]>();

export function noteSpin(spec: SlotSpec, result: SpinResult): void {
  const col = result.decor[WALKER_KEY];
  if (typeof col !== 'number') return;
  const strips = (spec as unknown as { board_law: { reel_sets: { strips: Strips }[] } }).board_law.reel_sets[result.set ?? 0].strips;
  const rows = result.finalBoard[col].length;
  covered.set(result.decor, coveredRows(strips, result.stops, col, rows));
}

export function noteRound(spec: SlotSpec, featureSpec: SlotSpec, round: SlotRound): void {
  noteSpin(spec, round.base);
  for (const s of round.feature?.spins ?? []) noteSpin(featureSpec, s.result);
}

/** True when this cell is the cook standing where a ticket was. */
export function holdsTicket(decor: Record<string, unknown> | undefined, col: number, row: number, symbol: number): boolean {
  if (!decor || symbol !== 2 || decor[WALKER_KEY] !== col) return false;
  return covered.get(decor)?.includes(row) ?? false;
}
