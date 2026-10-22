// Board geometry, kept free of React so the tests can check that what is drawn
// is the true chance: the bar above each door fills exactly P(door) of its
// track, and the strip under the doors splits 100% into one segment per
// closed door.

export const VIEW_W = 400;
export const VIEW_H = 400;

const AREA = { x: 8, y: 26, w: 384, h: 306 };
export const STRIP = { x: 14, y: 352, w: 372, h: 14 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell {
  /** The door itself. */
  door: Box;
  /** The full track of the chance bar above it (100% = full height). */
  bar: Box;
  /** Centre line of the cell. */
  cx: number;
  /** Baseline of the % label above the bar. */
  labelY: number;
  /** Baseline of the prize label under the door. */
  footY: number;
}

export interface Layout {
  cols: number;
  rows: number;
  cells: Cell[];
  /** Font size for labels. */
  font: number;
}

const GRID: Record<number, [number, number]> = { 3: [3, 1], 5: [5, 1], 8: [4, 2], 12: [6, 2] };

const cache = new Map<number, Layout>();

export function layout(n: number): Layout {
  const hit = cache.get(n);
  if (hit) return hit;
  const [cols, rows] = GRID[n] ?? [Math.min(n, 6), Math.ceil(n / 6)];
  const rowGap = rows > 1 ? 14 : 0;
  const cellW = AREA.w / cols;
  const cellH = (AREA.h - rowGap * (rows - 1)) / rows;
  const lab = rows === 1 ? 22 : 16;
  const foot = rows === 1 ? 24 : 16;
  const gap = 6;
  const avail = cellH - lab - foot - gap;
  const doorH = Math.min(Math.min(cellW * 0.62, 74) * 1.45, avail * (rows === 1 ? 0.45 : 0.4));
  const doorW = Math.min(cellW * 0.62, 74, doorH / 1.2);
  const barH = avail - doorH;
  const barW = doorW * 0.56;
  const font = rows === 1 ? (cols <= 3 ? 15 : 13) : cols <= 4 ? 11.5 : 10.5;
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cx = AREA.x + cellW * (c + 0.5);
    const top = AREA.y + r * (cellH + rowGap);
    const bar = { x: cx - barW / 2, y: top + lab, w: barW, h: barH };
    const door = { x: cx - doorW / 2, y: bar.y + barH + gap, w: doorW, h: doorH };
    cells.push({ door, bar, cx, labelY: top + lab - 6, footY: door.y + doorH + foot - 4 });
  }
  const out = { cols, rows, cells, font };
  cache.set(n, out);
  return out;
}

/** Filled height of a door's bar: exactly its chance of hiding the prize. */
export const barFill = (chance: number, trackH: number) => Math.max(0, Math.min(1, chance)) * trackH;

export interface Segment {
  door: number;
  x: number;
  w: number;
}

/**
 * The prize-location strip: 100% of the width split into one segment per
 * closed door, your door first, then the others in door order. Opened doors
 * keep a zero-width segment so the strip can animate their share flowing away.
 */
export function stripSegments(post: readonly number[], held: number): Segment[] {
  const order = [held, ...post.map((_, i) => i).filter((i) => i !== held)];
  let x = STRIP.x;
  return order.map((door) => {
    const w = post[door] * STRIP.w;
    const seg = { door, x, w };
    x += w;
    return seg;
  });
}
