// Board geometry, kept pure so the tests can check that what is drawn as the
// odds is exactly the odds: item t's slot row splits into t equal slots and the
// green (top) slot's share of the row is its record chance, 1/t.

export const VIEW = { w: 480, h: 312 };

/** The slot row: the draw. Item t's ball lands in one of t equal slots across it. */
export const ROW = { x0: 22, x1: 458, y: 92, h: 44 };
export const ROW_W = ROW.x1 - ROW.x0;

/** Where the ball waits before it drops. */
export const BALL_Y = 66;

/** The item row: one marker per item in the queue. */
export const ITEM_ROW = { x0: 22, x1: 458, y: 204 };

/** Slot `rank` (1 = bottom, t = top) of item t: an equal share of the row; the top slot is on the right. */
export function slotCell(t: number, rank: number) {
  const w = ROW_W / t;
  return { x: ROW.x0 + (rank - 1) * w, w };
}

/** Centre of item m's marker (m = 1..n). */
export const markerX = (n: number, m: number) => ITEM_ROW.x0 + ((m - 0.5) / n) * (ITEM_ROW.x1 - ITEM_ROW.x0);
