// Board geometry, independent of React: peg positions, bucket positions and the
// contact points a ball's path touches. Row r (0-based) has r + 3 pegs; after r
// bounces with R of them to the right, the ball sits on peg j = R + 1 of row r,
// and after all n bounces it is over bucket k = R. So the drawn path and the
// paid bucket always agree.

export const VIEW_W = 800;
const SIDE = 22;

export interface Layout {
  rows: number;
  /** Horizontal peg spacing (= bucket pitch). */
  s: number;
  /** Vertical row gap. */
  g: number;
  cx: number;
  /** y of row 0. */
  y0: number;
  pegR: number;
  ballR: number;
  bucketY: number;
  bucketH: number;
  barsY: number;
  barsH: number;
  height: number;
}

const cache = new Map<number, Layout>();

export function layoutFor(rows: number): Layout {
  const hit = cache.get(rows);
  if (hit) return hit;
  const s = (VIEW_W - 2 * SIDE) / (rows + 1);
  const g = s * 0.86;
  const pegR = Math.max(3.6, s * 0.095);
  const ballR = Math.min(s * 0.24, 15);
  // Room above the top peg for the ball to appear and fall in.
  const y0 = g * 1.1 + pegR + 2 * ballR + 8;
  const lastY = y0 + (rows - 1) * g;
  const bucketY = lastY + g * 0.62;
  const bucketH = Math.max(30, Math.min(42, s * 0.7));
  const barsY = bucketY + bucketH + 10;
  const barsH = 34;
  const l: Layout = { rows, s, g, cx: VIEW_W / 2, y0, pegR, ballR, bucketY, bucketH, barsY, barsH, height: barsY + barsH + 4 };
  cache.set(rows, l);
  return l;
}

export const pegX = (l: Layout, row: number, j: number) => l.cx + (j - (row + 2) / 2) * l.s;
export const pegY = (l: Layout, row: number) => l.y0 + row * l.g;
export const bucketX = (l: Layout, k: number) => l.cx + (k - l.rows / 2) * l.s;

export function pegs(l: Layout): { row: number; j: number; x: number; y: number }[] {
  const out = [];
  for (let r = 0; r < l.rows; r++) for (let j = 0; j < r + 3; j++) out.push({ row: r, j, x: pegX(l, r, j), y: pegY(l, r) });
  return out;
}

export interface Waypoint {
  x: number;
  y: number;
  /** The peg touched here (null for the spawn point and the bucket). */
  peg: { row: number; j: number } | null;
}

/** Spawn point, one contact per row (ball resting on top of the peg), then the bucket. */
export function waypoints(l: Layout, path: boolean[]): Waypoint[] {
  const lift = l.pegR + l.ballR;
  const pts: Waypoint[] = [{ x: l.cx, y: spawnY(l), peg: null }];
  let rights = 0;
  for (let r = 0; r < l.rows; r++) {
    const j = rights + 1;
    pts.push({ x: pegX(l, r, j), y: pegY(l, r) - lift, peg: { row: r, j } });
    if (path[r]) rights++;
  }
  pts.push({ x: bucketX(l, rights), y: l.bucketY + l.bucketH * 0.42, peg: null });
  return pts;
}

/**
 * Ball position along segment a → b at t ∈ [0, 1]: a small hop off the peg,
 * then a gravity fall (y = ya + v·t + a·t²/2 with v = −0.6·Δy). The first
 * segment is a plain drop from rest.
 */
export function along(a: Waypoint, b: Waypoint, t: number, first: boolean): { x: number; y: number } {
  const dy = b.y - a.y;
  const v = first ? 0 : -0.6 * dy;
  const acc = 2 * (dy - v);
  return { x: a.x + (b.x - a.x) * t, y: a.y + v * t + (acc * t * t) / 2 };
}

/** Where a new ball appears: above the top peg. */
export const spawnY = (l: Layout) => l.y0 - l.g * 1.1 - (l.pegR + l.ballR);
