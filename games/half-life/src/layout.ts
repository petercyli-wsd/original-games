// Board geometry, kept pure so the tests can check that what is drawn is the
// true probability: bar lengths are P(last), slice widths are P(next), and
// each atom's tail halves every half-life.
//
// Two column layouts share one row structure: a wide one, and a compact one
// for narrow frames (shorter lanes, so the text keeps its size on phones).

import { atomsIn, halfLife, nextChance } from './math';

export interface Layout {
  viewW: number;
  atomX: number;
  laneX0: number;
  laneX1: number;
  barX0: number;
  barW: number;
  textX: number;
}

export const WIDE: Layout = { viewW: 480, atomX: 34, laneX0: 68, laneX1: 300, barX0: 314, barW: 76, textX: 474 };
export const COMPACT: Layout = { viewW: 400, atomX: 30, laneX0: 60, laneX1: 222, barX0: 234, barW: 70, textX: 394 };
export const LAYOUTS = [WIDE, COMPACT];

export const VIEW_H = 404;
export const ROWS_TOP = 36;
export const ROWS_BOTTOM = 324;
export const AXIS_Y = ROWS_BOTTOM + 6;
export const NEXT_Y = 372;
export const NEXT_H = 16;
export const NEXT_GAP = 2;

export const rowHeight = (k: number) => (ROWS_BOTTOM - ROWS_TOP) / k;
export const rowY = (k: number, atom: number) => ROWS_TOP + rowHeight(k) * (atom - 0.5);

/** Nucleus radius: heavier (slower) atoms are drawn bigger. */
export function nucleusRadius(k: number, atom: number) {
  const rMax = Math.min(rowHeight(k) * 0.36, 21);
  return rMax * (0.62 + 0.38 * Math.sqrt(halfLife(atom) / 60));
}

/** Length of the "chance to be last" bar: the probability times the track. */
export const barLength = (L: Layout, p: number) => Math.max(0, Math.min(1, p)) * L.barW;

/** The time axis stretches as the clock runs, keeping room ahead of "now". */
export const axisMax = (now: number) => Math.max(60, now * 1.6);
export const timeX = (L: Layout, t: number, max: number) => L.laneX0 + (Math.min(t, max) / max) * (L.laneX1 - L.laneX0);

export function axisTicks(max: number): number[] {
  const step = [10, 20, 30, 60, 120, 240, 480].find((s) => max / s <= 4) ?? 960;
  const out: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) out.push(t);
  return out;
}

/** Half-width of an atom's survival tail s minutes ahead of now: it halves every half-life. */
export const tailHalfWidth = (atom: number, s: number, h0: number) => h0 * 2 ** (-s / halfLife(atom));

/** Closed path for the survival tail from `now` to the end of the lane (centred on y = 0). */
export function tailPath(L: Layout, atom: number, now: number, max: number, h0: number): string {
  const x0 = timeX(L, now, max);
  const perMin = (L.laneX1 - L.laneX0) / max;
  const top: string[] = [];
  const bottom: string[] = [];
  const n = Math.max(2, Math.ceil((L.laneX1 - x0) / 3));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((L.laneX1 - x0) * i) / n;
    const w = tailHalfWidth(atom, (x - x0) / perMin, h0);
    top.push(`${x.toFixed(2)} ${(-w).toFixed(2)}`);
    bottom.push(`${x.toFixed(2)} ${w.toFixed(2)}`);
  }
  return `M ${top.join(' L ')} L ${bottom.reverse().join(' L ')} Z`;
}

/** How many half-lives fit ahead of now on the lane (marks at least 7 px apart, at most 4). */
export function halvingMarks(L: Layout, atom: number, now: number, max: number): number[] {
  const out: number[] = [];
  const perMin = (L.laneX1 - L.laneX0) / max;
  if (halfLife(atom) * perMin < 7) return out;
  for (let n = 1; n <= 4; n++) {
    if (now + n * halfLife(atom) > max) break;
    out.push(n);
  }
  return out;
}

export interface Segment {
  atom: number;
  x: number;
  w: number;
}

/** Usable width of the next-decay bar once the gaps between slices are taken out. */
export const nextUsableWidth = (L: Layout, mask: number) => L.textX - L.laneX0 - NEXT_GAP * Math.max(0, atomsIn(mask).length - 1);

/** The "next decay" bar: one slice per survivor, its width the survivor's share of the decay rate. */
export function nextSegments(L: Layout, mask: number): Segment[] {
  const usable = nextUsableWidth(L, mask);
  let x = L.laneX0;
  return atomsIn(mask).map((atom) => {
    const w = usable * nextChance(mask, atom);
    const seg = { atom, x, w };
    x += w + NEXT_GAP;
    return seg;
  });
}
