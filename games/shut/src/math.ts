// Shut: Shut the Box as a cash-out game. Tiles 1..n start open. Each roll you
// must close open tiles that add up exactly to the dice total; if no set of
// open tiles makes the total, the round is lost. Close every tile to win.
// Two dice are rolled while the open tiles total more than 6; once they total
// 6 or less a single die is rolled (otherwise the last tiles could never go).
//
// The state is the set of open tiles, a bitmask over tiles 1..12 (bit i is
// tile i+1). Let V(S) be the chance of closing every tile from S under best
// play. Then V(∅) = 1 and, by backward induction (Bellman),
//
//   V(S) = Σ_t P(t) · max { V(S \ C) : C ⊆ S, ΣC = t }       (0 if no such C)
//
// where P(t) is the chance of total t (two dice: (6 − |t − 7|)/36; one die:
// 1/6). Every C is non-empty, so S \ C is a smaller mask: the table is filled
// in increasing mask order, exactly, over all 2¹² = 4096 open sets. It does
// not depend on the box size, so one table serves every box.
//
// Pricing (fixed prize with relock): prize = RTP / V(full box). At a
// checkpoint the cash-out is prize · V(S). After a roll of t the round is
// worth prize · V(S \ C*) for the best close C*, and the Bellman equation says
// the average of that over the roll is exactly prize · V(S): the cash-out is
// a martingale starting at RTP. Closing another set C instead relocks the
// prize at value / V(S \ C), so the cash-out is unchanged at the moment of
// choosing: the choice moves volatility, never value. Relocks that would push
// the prize above MAX_WIN are refused (the best close never changes the
// prize, so a legal close always exists). By optional stopping every strategy
// returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_WIN = 10_000;
/** Every payout is a prize, and no prize may exceed MAX_WIN. */
export const MAX_MULTIPLIER = MAX_WIN;

/** Box sizes: tiles 1..n. Bigger boxes are harder to shut. */
export const BOXES = [3, 5, 8, 10, 12] as const;
export type Box = (typeof BOXES)[number];

export const VOLATILITY: Record<Volatility, Box> = { low: 3, medium: 8, high: 10, extreme: 12 };

/** A set of tiles: bit i is tile i + 1. */
export type Mask = number;

const TILES = 12;
const SIZE = 1 << TILES;

export const fullBox = (n: number): Mask => (1 << n) - 1;
export const isOpen = (mask: Mask, tile: number) => ((mask >> (tile - 1)) & 1) === 1;
export const tilesOf = (mask: Mask): number[] => {
  const out: number[] = [];
  for (let i = 0; i < TILES; i++) if ((mask >> i) & 1) out.push(i + 1);
  return out;
};

let sums: Int32Array | null = null;
/** Sum of the tile numbers in each mask. */
function sumTable(): Int32Array {
  if (sums) return sums;
  sums = new Int32Array(SIZE);
  for (let m = 1; m < SIZE; m++) {
    const low = m & -m;
    sums[m] = sums[m ^ low] + 31 - Math.clz32(low) + 1;
  }
  return sums;
}
export const tileSum = (mask: Mask) => sumTable()[mask];

/** One die once the open tiles total 6 or less (and something is still open). */
export const oneDie = (mask: Mask) => mask !== 0 && tileSum(mask) <= 6;

export interface TotalChance {
  total: number;
  /** Chance of rolling this total. */
  p: number;
}

const TWO_DICE: TotalChance[] = Array.from({ length: 11 }, (_, i) => ({ total: i + 2, p: (6 - Math.abs(i + 2 - 7)) / 36 }));
const ONE_DIE: TotalChance[] = Array.from({ length: 6 }, (_, i) => ({ total: i + 1, p: 1 / 6 }));

/** The totals the next roll can show, with their chances. */
export const totals = (mask: Mask): TotalChance[] => (oneDie(mask) ? ONE_DIE : TWO_DICE);

let table: Float64Array | null = null;
/** V(S) for every open set S: the best-play chance of shutting the box. Built once (≈3¹² subset pairs, a few ms). */
export function winTable(): Float64Array {
  if (table) return table;
  const s = sumTable();
  const v = new Float64Array(SIZE);
  v[0] = 1;
  const best = new Float64Array(13);
  for (let m = 1; m < SIZE; m++) {
    best.fill(-1);
    for (let c = m; c; c = (c - 1) & m) {
      const t = s[c];
      if (t <= 12 && v[m ^ c] > best[t]) best[t] = v[m ^ c];
    }
    let p = 0;
    for (const { total, p: pt } of totals(m)) if (best[total] >= 0) p += pt * best[total];
    v[m] = p;
  }
  table = v;
  return v;
}

/** Best-play chance to shut the box from the open set. */
export const winChance = (mask: Mask) => winTable()[mask];

export interface Close {
  /** The tiles closed. */
  tiles: Mask;
  /** Open tiles afterwards. */
  after: Mask;
  /** Win chance afterwards (best play from there). */
  win: number;
}

/** Ties within this are treated as equal; the tie rule then prefers closing the higher tiles. */
const EPS = 1e-12;

const highFirst = (a: Mask, b: Mask) => {
  const ta = tilesOf(a).reverse();
  const tb = tilesOf(b).reverse();
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) if (ta[i] !== tb[i]) return tb[i] - ta[i];
  return ta.length - tb.length;
};

const closeCache = new Map<number, Close[]>();

/** Every legal close for a roll of t, best first (highest win chance after; ties close the higher tiles). Empty = the roll busts. Cached. */
export function closes(mask: Mask, t: number): Close[] {
  const key = mask * 16 + t;
  const hit = closeCache.get(key);
  if (hit) return hit;
  const s = sumTable();
  const v = winTable();
  const out: Close[] = [];
  for (let c = mask; c; c = (c - 1) & mask) if (s[c] === t) out.push({ tiles: c, after: mask ^ c, win: v[mask ^ c] });
  out.sort((a, b) => (Math.abs(b.win - a.win) > EPS ? b.win - a.win : highFirst(a.tiles, b.tiles)));
  closeCache.set(key, out);
  return out;
}

/** Win chance after the best close for a roll of t (0 when the roll busts). */
export function afterRoll(mask: Mask, t: number): number {
  const [best] = closes(mask, t);
  return best ? best.win : 0;
}

export interface NextTotal extends TotalChance {
  /** Some set of open tiles adds up to it. */
  playable: boolean;
  /** Win chance after the best close (0 if not playable). */
  win: number;
}

/** The totals strip: each total's chance, whether you could play it, and the odds after the best close. */
export const nextRoll = (mask: Mask): NextTotal[] =>
  totals(mask).map((tc) => {
    const [best] = closes(mask, tc.total);
    return { ...tc, playable: !!best, win: best ? best.win : 0 };
  });

const playable = new Map<Mask, number>();
/** Chance the next roll can be played at all: the green share of the totals strip. */
export function playableChance(mask: Mask): number {
  let p = playable.get(mask);
  if (p === undefined) playable.set(mask, (p = nextRoll(mask).reduce((a, x) => a + (x.playable ? x.p : 0), 0)));
  return p;
}

export const startPrize = (n: number) => RTP / winChance(fullBox(n));

/**
 * Relock after closing `chosen` when the best close would have left `bestWin`:
 * the value prize · bestWin is kept and the prize becomes value / chosen.win.
 * Returns null if the new prize would exceed MAX_WIN.
 */
export function relock(prize: number, bestWin: number, chosen: Close): number | null {
  if (chosen.win >= bestWin - EPS) return prize;
  const next = (prize * bestWin) / chosen.win;
  return next > MAX_WIN ? null : next;
}

/** A roll of the dice: faces and total. One die once the open tiles total 6 or less. */
export function rollDice(mask: Mask, int: (n: number) => number): { dice: number[]; total: number } {
  const dice = oneDie(mask) ? [1 + int(6)] : [1 + int(6), 1 + int(6)];
  return { dice, total: dice.reduce((a, b) => a + b, 0) };
}

export function volatilityOf(n: Box): Volatility {
  const p = winChance(fullBox(n));
  return p > 0.2 ? 'low' : p > 0.08 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}
