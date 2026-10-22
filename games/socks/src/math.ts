// Socks: n pairs of coloured tokens (2n tokens) are shuffled and drawn one at
// a time. A token whose twin is not out yet goes onto a table with k slots;
// when its twin is drawn, the pair clears and frees the slot. The round is
// lost if a token without a twin on the table arrives while all k slots are
// full. Draw every token and the round pays out.
//
// The whole state, as far as the odds are concerned, is (u, t): u untouched
// pairs (both tokens still in the pile) and t tokens on the table (each with
// its twin still in the pile). The pile holds 2u + t tokens in uniformly
// random order, so the next one is a twin of a table token with chance
// t / (2u + t). While the table has room (t < k) every draw is safe: a "free"
// draw. When it is full (t = k) the next draw is safe exactly when it is one
// of the t twins, chance t / (2u + t): the green tokens over all the tokens in
// the pile, drawn literally on the board.
//
// Pricing (ladder): surviving a draw with bust chance q multiplies the cash-out
// by 1/(1 − q), and free draws leave it alone. Then E[cash after a draw] =
// (1 − q) · cash/(1 − q) = cash, so the cash-out is a martingale starting at
// RTP and every stopping rule returns exactly RTP (optional stopping).
//
// The exact chance of clearing everything is a DP over (u, t):
//   W(0, t) = 1,
//   W(u, t) = t/(2u+t) · W(u, t−1) + [t < k] · 2u/(2u+t) · W(u−1, t+1).
// With k = 1 it reduces to n! 2ⁿ / (2n)! (every pair drawn back to back).
//
// Max win: the largest cash-out along any surviving path is a max-product DP
// over the same states. For tight tables it runs into the millions, so a cap
// applies: before a risky draw, if surviving would lift the cash-out above
// MAX_WIN, the round auto-cashes instead. That is a stopping rule, so the RTP
// is unchanged, and every payout is at most MAX_WIN.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_WIN = 10_000;

/** Pairs in the pile (2n tokens). */
export const PAIRS = [5, 6, 7, 8, 9, 10, 11, 12] as const;
/** Table slots. Only k < n is offered: with k ≥ n nothing can ever bust. */
export const SLOTS = [2, 3, 4, 5, 6] as const;

export interface Settings {
  pairs: number;
  slots: number;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { pairs: 7, slots: 4 },
  medium: { pairs: 8, slots: 4 },
  high: { pairs: 10, slots: 4 },
  extreme: { pairs: 12, slots: 3 },
};

export const slotsAllowed = (pairs: number, slots: number) => slots < pairs;

// ---------- The deal ----------

/** Token ids: 2·pair + copy (copy 0 or 1). */
export const pairOf = (token: number) => token >> 1;
export const twinOf = (token: number) => token ^ 1;

export interface Deal {
  pairs: number;
  slots: number;
  /** Tokens still to draw (kept sorted; the draw order is uniform, so order doesn't matter). */
  pile: number[];
  /** The pair waiting in each table slot, or null for an empty slot. */
  table: (number | null)[];
  /** Pairs cleared so far, in the order they cleared. */
  matched: number[];
}

export function newDeal(pairs: number, slots: number): Deal {
  return {
    pairs,
    slots,
    pile: Array.from({ length: 2 * pairs }, (_, i) => i),
    table: Array.from({ length: slots }, () => null),
    matched: [],
  };
}

export interface Counts {
  /** Untouched pairs: both tokens still in the pile. */
  u: number;
  /** Tokens on the table (each one's twin is in the pile). */
  t: number;
  /** Tokens left in the pile, 2u + t. */
  left: number;
}

export function counts(d: Deal): Counts {
  const t = d.table.filter((p) => p !== null).length;
  const left = d.pile.length;
  return { u: (left - t) / 2, t, left };
}

/** Whether a token's twin is waiting on the table (drawing it clears a pair). */
export const hasTwinOnTable = (d: Deal, token: number) => d.table.includes(pairOf(token));

/** Chance the next draw loses the round: the table is full and the token has no twin there. */
export function risk(d: Deal): number {
  const { u, t, left } = counts(d);
  return t === d.slots && u > 0 ? (2 * u) / left : 0;
}

export type DrawKind = 'new' | 'twin' | 'bust';

export interface DrawResult {
  /** The deal after the draw (on a bust, the deal before it: the round ends there). */
  deal: Deal;
  token: number;
  kind: DrawKind;
  /** The table slot the token went to, or its twin's slot. -1 on a bust. */
  slot: number;
}

/** Draws pile[index]. A uniform index gives a uniform draw. */
export function draw(d: Deal, index: number): DrawResult {
  const token = d.pile[index];
  const pair = pairOf(token);
  const pile = d.pile.filter((_, i) => i !== index);
  const twinSlot = d.table.indexOf(pair);
  if (twinSlot >= 0) {
    const table = d.table.map((p, i) => (i === twinSlot ? null : p));
    return { deal: { ...d, pile, table, matched: [...d.matched, pair] }, token, kind: 'twin', slot: twinSlot };
  }
  const free = d.table.indexOf(null);
  if (free < 0) return { deal: d, token, kind: 'bust', slot: -1 };
  const table = d.table.map((p, i) => (i === free ? pair : p));
  return { deal: { ...d, pile, table }, token, kind: 'new', slot: free };
}

/** Cash-out after surviving a draw that had bust chance q. */
export const afterSafeDraw = (cash: number, q: number) => (q > 0 ? cash / (1 - q) : cash);

/** Max-win stopping rule: true if surviving the next draw would lift the cash-out above MAX_WIN. */
export const hitsCap = (cash: number, q: number) => q > 0 && cash / (1 - q) > MAX_WIN + 1e-9;

// ---------- Exact tables ----------

interface Tables {
  /** W[u][t]: chance to draw every token from state (u, t). */
  win: number[][];
  /** M[u][t]: the largest product of draw factors along any surviving path from (u, t). */
  maxPath: number[][];
}

const cache = new Map<string, Tables>();

function tables(pairs: number, slots: number): Tables {
  const id = `${pairs}/${slots}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const win: number[][] = [];
  const maxPath: number[][] = [];
  for (let u = 0; u <= pairs; u++) {
    win.push([]);
    maxPath.push([]);
    for (let t = 0; t <= Math.min(slots, pairs - u); t++) {
      if (u === 0) {
        win[u][t] = 1;
        maxPath[u][t] = 1;
        continue;
      }
      const left = 2 * u + t;
      let w = 0;
      let m = 0;
      if (t > 0) {
        const factor = t === slots ? left / t : 1;
        w += (t / left) * win[u][t - 1];
        m = Math.max(m, factor * maxPath[u][t - 1]);
      }
      if (t < slots) {
        w += ((2 * u) / left) * win[u - 1][t + 1];
        m = Math.max(m, maxPath[u - 1][t + 1]);
      }
      win[u][t] = w;
      maxPath[u][t] = m;
    }
  }
  const out = { win, maxPath };
  cache.set(id, out);
  return out;
}

/** Exact chance to draw every token from (u untouched pairs, t on the table). */
export const winChanceFrom = (pairs: number, slots: number, u: number, t: number) => tables(pairs, slots).win[u][t];

/** Exact chance to clear all n pairs with a k-slot table. */
export const winChance = (pairs: number, slots: number) => winChanceFrom(pairs, slots, pairs, 0);

/** Exact chance to clear everything from a live deal. */
export function dealWinChance(d: Deal): number {
  const { u, t } = counts(d);
  return winChanceFrom(d.pairs, d.slots, u, t);
}

/** The largest payout these settings can reach (the max-win cap included). */
export const maxMultiplier = (pairs: number, slots: number) => Math.min(MAX_WIN, RTP * tables(pairs, slots).maxPath[pairs][0]);

export const MAX_MULTIPLIER = Math.max(
  ...PAIRS.flatMap((n) => SLOTS.filter((k) => slotsAllowed(n, k)).map((k) => maxMultiplier(n, k))),
);

export function volatilityOf(pairs: number, slots: number): Volatility {
  const p = winChance(pairs, slots);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}
