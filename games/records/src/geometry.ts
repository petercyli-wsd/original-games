// Board geometry, kept pure so the tests can check that what is drawn as the
// odds is exactly the odds: the pink top slot of the ladder, the pink caps on
// future columns, the green share of the run bracket and of the finish strip.

import type { FinishShare, RunWindow } from './math';

export const VIEW = { w: 480, h: 314 };

/** The skyline: one column per item, floor at `bottom`, the record line at `top`. */
export const SKY = { x0: 22, x1: 392, top: 62, bottom: 198 };
export const SKY_H = SKY.bottom - SKY.top;

/** The insertion ladder for one item, to the right of the skyline. */
export const LADDER = { x: 418, w: 40, top: SKY.top, bottom: SKY.bottom };

export const BRACKET = { y: 221, h: 7 };
export const STRIP = { x0: 22, x1: 458, y: 280, h: 28 };

const skyW = SKY.x1 - SKY.x0;

/** Left edge of item m's column (m = 0 is the start of the queue, m = n its end). */
export const edgeX = (n: number, m: number) => SKY.x0 + (m / n) * skyW;
export const colW = (n: number) => skyW / n;
export const colX = (n: number, m: number) => edgeX(n, m - 0.5);

/** An arrived item's bar: it filled the column up to the slot it took (rank of t). A record fills it. */
export const barHeight = (rank: number, t: number) => (rank / t) * SKY_H;

/** A future item's pink cap hangs from the record line: one t-th of the column, its record chance. */
export const capHeight = (t: number) => SKY_H / t;

/** Slot `rank` (1 = bottom, t = top) of item t's ladder. */
export function ladderCell(t: number, rank: number) {
  const h = (LADDER.bottom - LADDER.top) / t;
  return { y: LADDER.bottom - rank * h, h };
}

/** The run bracket on the item axis: [0, seen] is used up, (seen, until] is green. */
export function bracket(n: number, w: RunWindow) {
  return { x0: edgeX(n, 0), xSeen: edgeX(n, w.seen), xUntil: edgeX(n, w.until) };
}

/** Lays the finish shares end to end across the strip; widths are the probabilities. */
export function stripSegments(shares: readonly FinishShare[]) {
  const width = STRIP.x1 - STRIP.x0;
  let x = STRIP.x0;
  return shares.map((s) => {
    const seg = { ...s, x, w: s.p * width };
    x += seg.w;
    return seg;
  });
}
