// Turf: two paints spread over a 4 x 4 grid. Your paint starts in the top-left
// cell, the house paint in the bottom-right. An ARROW is a pair (a painted
// cell, an empty cell next to it). Each tick one arrow is picked uniformly from
// all arrows on the board, and its empty cell takes that arrow's paint. A cell
// that both paints touch is therefore won in proportion to its arrows.
//
// You win when you hold k of the 16 cells; the house wins when it holds
// 17 - k. Both cannot be reached at once and someone always gets there
// (k + (17 - k) = 17 > 16), so a round never ties and cells may stay empty.
//
// CAPTURE: after a tick that has not decided the round, every empty pocket
// (empty cells joined side by side) that touches only one paint fills with that
// paint at once. Such a pocket is certain to go to that paint, so this changes
// nobody's chance: P(win | state) is the same just before and just after a
// capture. It only stops the round running ticks whose result is already fixed.
// Every pocket created by a fill touches the cell just filled, so a capture
// always goes to the paint that just spread.
//
// Exact odds: P(win | you, house) is the one-tick recursion over the arrows,
// memoised per target, with no capture in it (the plain two-paint growth
// process). The tests check that process against the capture rule at every
// reached state. Pricing (fixed prize, contract pattern 1): prize = RTP / P(win
// at the start), cash-out = prize * P(win | state), a martingale in the ticks,
// so every stopping rule returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const SIDE = 4;
export const CELLS = SIDE * SIDE;
export const TARGETS = [5, 7, 9, 11, 13, 15] as const;
export const DEFAULT_TARGET = 9;
export type Target = (typeof TARGETS)[number];

/** Cells are numbered row by row: 0 is top-left, 15 is bottom-right. */
export const YOU_START = 0;
export const HOUSE_START = CELLS - 1;
const FULL = (1 << CELLS) - 1;

export type Paint = 'you' | 'house';

/** Which cells each paint holds (bit i = cell i), and the target k. */
export interface State {
  you: number;
  house: number;
  k: number;
}

export const bit = (i: number) => 1 << i;
export const has = (mask: number, i: number) => (mask & bit(i)) !== 0;
export function count(mask: number): number {
  let m = mask - ((mask >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function cellsOf(mask: number): number[] {
  const out: number[] = [];
  for (let m = mask; m; m &= m - 1) out.push(31 - Math.clz32(m & -m));
  return out;
}
/** The house needs this many cells to win. */
export const houseNeed = (k: number) => CELLS + 1 - k;

export const start = (k: number): State => ({ you: bit(YOU_START), house: bit(HOUSE_START), k });
export const emptyMask = (s: State) => FULL & ~(s.you | s.house);

const NBR: number[] = Array.from({ length: CELLS }, (_, i) => {
  const r = Math.floor(i / SIDE);
  const c = i % SIDE;
  let m = 0;
  if (r > 0) m |= bit(i - SIDE);
  if (r < SIDE - 1) m |= bit(i + SIDE);
  if (c > 0) m |= bit(i - 1);
  if (c < SIDE - 1) m |= bit(i + 1);
  return m;
});
export const neighbours = (i: number): number[] => cellsOf(NBR[i]);

export function winner(s: State): Paint | null {
  if (count(s.you) >= s.k) return 'you';
  if (count(s.house) >= houseNeed(s.k)) return 'house';
  return null;
}

export interface Arrow {
  from: number;
  to: number;
  paint: Paint;
}

/** Every arrow on the board, in a fixed order (by empty cell, then by painted cell). */
export function arrows(s: State): Arrow[] {
  const out: Arrow[] = [];
  const empty = emptyMask(s);
  for (let to = 0; to < CELLS; to++) {
    if (!has(empty, to)) continue;
    for (const from of neighbours(to)) {
      if (has(s.you, from)) out.push({ from, to, paint: 'you' });
      else if (has(s.house, from)) out.push({ from, to, paint: 'house' });
    }
  }
  return out;
}

export function arrowCounts(s: State): { you: number; house: number } {
  let you = 0;
  let house = 0;
  for (const a of arrows(s)) if (a.paint === 'you') you++;
  else house++;
  return { you, house };
}

const memo = new Map<number, Map<number, number>>();

/** Your exact chance to hold k cells before the house holds 17 - k. */
export function winChance(s: State): number {
  const w = winner(s);
  if (w) return w === 'you' ? 1 : 0;
  let table = memo.get(s.k);
  if (!table) memo.set(s.k, (table = new Map()));
  return solve(s.you, s.house, s.k, table);
}

function solve(you: number, house: number, k: number, table: Map<number, number>): number {
  if (count(you) >= k) return 1;
  if (count(house) >= houseNeed(k)) return 0;
  const key = you + house * 65536;
  const hit = table.get(key);
  if (hit !== undefined) return hit;
  const empty = FULL & ~(you | house);
  let total = 0;
  let v = 0;
  for (let c = 0; c < CELLS; c++) {
    if (!has(empty, c)) continue;
    const a = count(NBR[c] & you);
    const h = count(NBR[c] & house);
    if (a) v += a * solve(you | bit(c), house, k, table);
    if (h) v += h * solve(you, house | bit(c), k, table);
    total += a + h;
  }
  const p = v / total;
  table.set(key, p);
  return p;
}

/** The pockets (groups of empty cells joined side by side) and which paints each touches. */
export function pockets(s: State): { cells: number[]; touchesYou: boolean; touchesHouse: boolean }[] {
  let left = emptyMask(s);
  const out: { cells: number[]; touchesYou: boolean; touchesHouse: boolean }[] = [];
  while (left) {
    const first = 31 - Math.clz32(left & -left);
    let pocket = bit(first);
    let frontier = pocket;
    let around = 0;
    while (frontier) {
      let next = 0;
      for (let m = frontier; m; m &= m - 1) {
        const nb = NBR[31 - Math.clz32(m & -m)];
        around |= nb;
        next |= nb & left & ~pocket;
      }
      pocket |= next;
      frontier = next;
    }
    left &= ~pocket;
    out.push({ cells: cellsOf(pocket), touchesYou: (around & s.you) !== 0, touchesHouse: (around & s.house) !== 0 });
  }
  return out;
}

/** The empty cells a capture fills now, and for whom (undefined when nothing is walled off). */
export function capture(s: State): { paint: Paint; cells: number[] } | null {
  let paint: Paint | null = null;
  const cells: number[] = [];
  for (const p of pockets(s)) {
    if (p.touchesYou && p.touchesHouse) continue;
    paint = p.touchesYou ? 'you' : 'house';
    cells.push(...p.cells);
  }
  return paint && cells.length ? { paint, cells } : null;
}

export function fill(s: State, cell: number, paint: Paint): State {
  return paint === 'you' ? { ...s, you: s.you | bit(cell) } : { ...s, house: s.house | bit(cell) };
}

export interface Tick {
  /** Index into arrows(s) that the tick picked. */
  index: number;
  arrow: Arrow;
  /** Both paints touched the cell. */
  contested: boolean;
  /** After the cell fills. */
  filled: State;
  /** The pocket(s) the capture fills, if any (never when the cell decided the round). */
  captured: { paint: Paint; cells: number[] } | null;
  /** After the capture. */
  after: State;
}

/** One tick: a uniform u in [0, 1) picks the arrow; its cell fills; then any capture. */
export function tick(s: State, u: number): Tick {
  const list = arrows(s);
  const index = Math.min(list.length - 1, Math.floor(u * list.length));
  const arrow = list[index];
  const contested = list.some((a) => a.to === arrow.to && a.paint !== arrow.paint);
  const filled = fill(s, arrow.to, arrow.paint);
  const cap = winner(filled) ? null : capture(filled);
  let after = filled;
  if (cap) for (const c of cap.cells) after = fill(after, c, cap.paint);
  return { index, arrow, contested, filled, captured: cap, after };
}

/** Every outcome of the next tick with its chance (an arrow is 1 / arrows), after any capture. */
export function outcomes(s: State): { p: number; after: State; tick: Tick }[] {
  const n = arrows(s).length;
  return Array.from({ length: n }, (_, i) => {
    const t = tick(s, (i + 0.5) / n);
    return { p: 1 / n, after: t.after, tick: t };
  });
}

/** The prize (x stake) for a full win at target k. */
export const prizeFor = (k: number) => RTP / winChance(start(k));
export const MAX_MULTIPLIER = Math.max(...TARGETS.map(prizeFor));

/** What the round pays right now: the prize won, 0 lost, else prize x chance. */
export function cashOf(s: State, prize: number): number {
  const w = winner(s);
  return w ? (w === 'you' ? prize : 0) : prize * winChance(s);
}

export function volatilityOf(k: number): Volatility {
  const w = winChance(start(k));
  return w > 0.5 ? 'low' : w > 0.2 ? 'medium' : w > 0.05 ? 'high' : 'extreme';
}

/** Auto cash-out targets (x stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  ticks: Tick[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/** One whole Auto round: spread until decided, or cash out once the cash-out reaches `cashAt`. */
export function autoRound(k: number, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(k);
  let s = start(k);
  const ticks: Tick[] = [];
  for (;;) {
    const t = tick(s, u());
    s = t.after;
    ticks.push(t);
    const w = winner(s);
    if (w) return { ticks, multiplier: w === 'you' ? prize : 0, outcome: w === 'you' ? 'win' : 'lose' };
    const cash = prize * winChance(s);
    if (cashAt !== null && cash >= cashAt) return { ticks, multiplier: cash, outcome: 'cashed' };
  }
}
