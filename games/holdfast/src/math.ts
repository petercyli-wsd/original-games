// Holdfast: a 3-4-4-4-3 slot with 40 fixed lines, free spins and a hold-and-spin "lock" feature.
//
// Board: five reels with 3, 4, 4, 4, 3 rows (18 cells). Each cell is drawn independently from one of
// two weight tables (outer reels 1 and 5, inner reels 2-4; only the inner table has the scatter).
// All 40 lines always play. A line pays left to right from reel 1; the Wild stands in for every
// symbol except the scatter; a line pays only its best symbol. Pays are multiples of the TOTAL bet.
//
// Features:
//   Free spins. 3+ scatters (they can only land on the inner reels) award 10 spins on a richer
//     paytable. The same trigger in a free spin adds 10 more, up to 180 spins awarded in all.
//   Lock. A full column of keystones on reel 1 or on reel 5 (both full is still one feature) plays
//     exactly 5 respins of the 12 inner cells. Every respin redraws the unlocked cells; a keystone
//     locks. The feature pays LOCK_PAY[locked count]. It ends early when all 12 are locked, which
//     changes nothing: there is nothing more to win. A lock in a free spin pauses the free spins.
//
// There is no cash-out, no volatility setting and nothing the player can edit that prices the game:
// the one config is the same for every bet. Everything is drawn in one go by playRound, after the
// bet is placed; the UI only replays it.
//
// Exact RTP (Wald's identity: whether a free spin is played is decided before it is drawn):
//   RTP = 40 Lb + t E_lock + q N (40 Lf + t E_lock)
//   Lb, Lf  = expected pay of ONE line (every line has the same law; computed by enumerating all
//             11 x 12 x 12 x 12 x 11 symbol tuples) on the base and free-spin paytables
//   q       = P(at least 3 scatters in the 12 inner cells)
//   t       = 1 - (1 - kO^3)^2, the chance a spin opens the lock (kO = outer keystone chance)
//   E_lock  = E[LOCK_PAY[final count]], each inner cell ending locked with 1 - (1 - kI)^5
//   N       = expected free spins played from one 10-spin award (the 180 cap, by DP)
// The weights are the reverse-engineered classic weights times 10, with a few ten-thousandths moved
// from the commonest symbol to the Wild so the exact RTP lands at 0.99 (just under).

import type { Rng } from '@originals/game-sdk';

export const REELS = 5;
export const ROWS_PER_REEL = [3, 4, 4, 4, 3] as const;
export const LINES = 40;
export const CELLS = 18;
export const FREE_AWARD = 10;
export const FREE_CAP = 180;
export const LOCK_RESPINS = 5;
export const LOCK_CELLS = 12;

/** Symbols: 0-8 plain shapes (best-paying tier last in the base paytable is s5-s7), 9 keystone, 10 scatter, 11 wild. */
export const KEY = 9;
export const SCATTER = 10;
export const WILD = 11;
export const SYMBOLS = 12;

export const OUTER_W = [750, 750, 800, 800, 800, 800, 800, 800, 1461, 1700, 539] as const; // s1..s9, keystone, wild
export const INNER_W = [900, 900, 700, 600, 900, 800, 800, 650, 1496, 1200, 400, 654] as const; // s1..s9, keystone, scatter, wild
export const WEIGHT_TOTAL = 10_000;

/** Symbol ids in the order of each weight table. */
export const OUTER_SYMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, KEY, WILD] as const;
export const INNER_SYMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, KEY, SCATTER, WILD] as const;

/** Pays for 3, 4 and 5 of a kind, in multiples of the total bet, per symbol 0-9 and the wild. */
export type PayRow = readonly [number, number, number];
export const PAY_BASE: Record<number, PayRow> = {
  0: [0, 1.5, 3],
  1: [0, 1.5, 3],
  2: [0, 1.5, 4],
  3: [0, 1.5, 4],
  4: [0, 2, 4],
  5: [0, 2, 4],
  6: [0, 2, 4],
  7: [0, 1.5, 3],
  8: [0, 1.5, 3],
  [KEY]: [0.5, 1, 1.5],
  [WILD]: [0, 2.5, 12.5],
};
export const PAY_FREE: Record<number, PayRow> = {
  0: [1, 2, 8],
  1: [1, 2, 8],
  2: [1.5, 3, 10],
  3: [1.5, 3, 10],
  4: [2, 4, 12],
  5: [2, 4, 12],
  6: [2, 4, 12],
  7: [1.5, 3, 10],
  8: [1.5, 3, 10],
  [KEY]: [0.5, 2, 4],
  [WILD]: [5, 10, 20],
};
/** What the lock feature pays for 0..12 locked keystones. */
export const LOCK_PAY = [0, 1, 1.5, 2, 2.5, 5, 8, 12, 16, 30, 100, 250, 500] as const;

/** The 40 fixed lines: the row used on each reel. */
export const PAYLINES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [1, 1, 1, 1, 1], [1, 2, 2, 2, 1], [2, 2, 2, 2, 2],
  [2, 3, 3, 3, 2], [0, 0, 1, 0, 0], [0, 1, 0, 1, 0], [1, 1, 2, 1, 1], [1, 2, 1, 2, 1],
  [2, 2, 3, 2, 2], [2, 3, 2, 3, 2], [0, 0, 0, 1, 0], [0, 1, 1, 0, 0], [1, 1, 1, 2, 1],
  [1, 2, 2, 1, 1], [2, 2, 2, 3, 2], [2, 3, 3, 2, 2], [0, 0, 1, 1, 0], [0, 1, 0, 0, 0],
  [1, 1, 2, 2, 1], [1, 2, 1, 1, 1], [2, 2, 3, 3, 2], [2, 3, 2, 2, 2], [0, 1, 2, 1, 0],
  [1, 2, 3, 2, 1], [1, 1, 0, 1, 1], [2, 2, 1, 2, 2], [0, 1, 2, 2, 1], [1, 2, 3, 3, 2],
  [1, 1, 0, 0, 0], [2, 2, 1, 1, 1], [0, 2, 1, 2, 1], [1, 3, 2, 3, 2], [1, 0, 1, 0, 0],
  [2, 1, 2, 1, 1], [2, 1, 0, 1, 2], [0, 2, 3, 2, 0], [1, 0, 0, 0, 1], [1, 3, 3, 3, 1],
];

/** The honest bound on any round: a base spin (40 x 12.5) + a lock, and 180 free spins of (40 x 20) + a lock. */
export const MAX_MULTIPLIER = 500 + 500 + FREE_CAP * (40 * 20 + 500);

export type Grid = number[][]; // grid[reel][row]

const cumulative = (w: readonly number[]) => {
  let s = 0;
  return w.map((x) => (s += x));
};
const OUTER_CUM = cumulative(OUTER_W);
const INNER_CUM = cumulative(INNER_W);

function pick(rng: Rng, cum: readonly number[], syms: readonly number[]): number {
  const u = rng.int(WEIGHT_TOTAL);
  for (let i = 0; i < cum.length; i++) if (u < cum[i]) return syms[i];
  return syms[syms.length - 1];
}

export const isOuter = (reel: number) => reel === 0 || reel === REELS - 1;

export function drawGrid(rng: Rng): Grid {
  return ROWS_PER_REEL.map((rows, r) =>
    Array.from({ length: rows }, () => (isOuter(r) ? pick(rng, OUTER_CUM, OUTER_SYMS) : pick(rng, INNER_CUM, INNER_SYMS))),
  );
}

/** What a line of five symbols pays: the best single symbol, the wild standing in for all but the scatter. */
export function linePay(line: readonly number[], table: Record<number, PayRow>): { pay: number; sym: number; run: number } {
  let best = { pay: 0, sym: -1, run: 0 };
  for (let t = 0; t <= KEY; t++) {
    let run = 0;
    while (run < REELS && (line[run] === t || line[run] === WILD)) run++;
    if (run >= 3 && table[t][run - 3] > best.pay) best = { pay: table[t][run - 3], sym: t, run };
  }
  let run = 0;
  while (run < REELS && line[run] === WILD) run++;
  if (run >= 3 && table[WILD][run - 3] > best.pay) best = { pay: table[WILD][run - 3], sym: WILD, run };
  return best;
}

export interface LineWin {
  line: number;
  sym: number;
  run: number;
  pay: number;
}

export function evalGrid(grid: Grid, free: boolean): { wins: LineWin[]; pay: number } {
  const table = free ? PAY_FREE : PAY_BASE;
  const wins: LineWin[] = [];
  let pay = 0;
  PAYLINES.forEach((rows, line) => {
    const w = linePay(rows.map((row, r) => grid[r][row]), table);
    if (w.pay > 0) {
      wins.push({ line, ...w });
      pay += w.pay;
    }
  });
  return { wins, pay };
}

export const countScatters = (grid: Grid) => grid.reduce((n, col) => n + col.filter((s) => s === SCATTER).length, 0);
export const fullColumn = (grid: Grid, reel: 0 | 4) => grid[reel].every((s) => s === KEY);
export const lockTriggered = (grid: Grid) => fullColumn(grid, 0) || fullColumn(grid, 4);

// ---------- The round ----------

export interface SpinEvent {
  type: 'spin';
  free: boolean;
  /** Free spin number (1-based) and spins awarded so far; 0 for the paid spin. */
  n: number;
  of: number;
  grid: Grid;
  wins: LineWin[];
  pay: number;
  scatters: number;
  /** Spins added by this spin (retrigger), 0 if none. */
  added: number;
  lock: boolean;
  /** Spins this paid spin awarded (paid spin only). */
  awarded: number;
}

export interface LockEvent {
  type: 'lock';
  free: boolean;
  /** After each respin: the locked cells (index = (reel - 1) * 4 + row) and the cells that just landed. */
  respins: { held: boolean[]; landed: boolean[] }[];
  count: number;
  pay: number;
}

export type RoundEvent = SpinEvent | LockEvent;

export interface Round {
  events: RoundEvent[];
  multiplier: number;
  /** Paid spin plus free spins. */
  spins: number;
}

export function playLock(rng: Rng, free: boolean): LockEvent {
  const held = new Array<boolean>(LOCK_CELLS).fill(false);
  const respins: LockEvent['respins'] = [];
  for (let k = 0; k < LOCK_RESPINS && held.some((h) => !h); k++) {
    const landed = new Array<boolean>(LOCK_CELLS).fill(false);
    for (let i = 0; i < LOCK_CELLS; i++) {
      if (!held[i] && rng.int(WEIGHT_TOTAL) < INNER_W[KEY]) {
        landed[i] = true;
        held[i] = true;
      }
    }
    respins.push({ held: [...held], landed });
  }
  const count = held.filter(Boolean).length;
  return { type: 'lock', free, respins, count, pay: LOCK_PAY[count] };
}

/** One whole round: the paid spin, its lock, then every free spin (and lock) it leads to. Draw only after the bet is placed. */
export function playRound(rng: Rng): Round {
  const events: RoundEvent[] = [];
  let multiplier = 0;
  let spins = 0;
  let awarded = 0;
  let remaining = 0;

  const spin = (free: boolean, n: number) => {
    const grid = drawGrid(rng);
    const { wins, pay } = evalGrid(grid, free);
    const scatters = countScatters(grid);
    const lock = lockTriggered(grid);
    let added = 0;
    let award = 0;
    if (scatters >= 3) {
      if (!free) {
        award = FREE_AWARD;
        awarded = FREE_AWARD;
        remaining = FREE_AWARD;
      } else {
        added = Math.min(FREE_AWARD, FREE_CAP - awarded);
        awarded += added;
        remaining += added;
      }
    }
    multiplier += pay;
    spins++;
    events.push({ type: 'spin', free, n, of: awarded, grid, wins, pay, scatters, added, lock, awarded: award });
    if (lock) {
      const l = playLock(rng, free);
      multiplier += l.pay;
      events.push(l);
    }
  };

  spin(false, 0);
  for (let n = 1; remaining > 0; n++) {
    remaining--;
    spin(true, n);
  }
  return { events, multiplier, spins };
}

// ---------- Exact maths ----------

const outerP = OUTER_W.map((w) => w / WEIGHT_TOTAL);
const innerP = INNER_W.map((w) => w / WEIGHT_TOTAL);

/** E[pay of one line] on a paytable, by enumerating every symbol tuple. */
export function lineEv(table: Record<number, PayRow>): number {
  let ev = 0;
  const line = [0, 0, 0, 0, 0];
  for (let a = 0; a < OUTER_SYMS.length; a++) {
    line[0] = OUTER_SYMS[a];
    for (let b = 0; b < INNER_SYMS.length; b++) {
      line[1] = INNER_SYMS[b];
      const pab = outerP[a] * innerP[b];
      for (let c = 0; c < INNER_SYMS.length; c++) {
        line[2] = INNER_SYMS[c];
        const pabc = pab * innerP[c];
        for (let d = 0; d < INNER_SYMS.length; d++) {
          line[3] = INNER_SYMS[d];
          const pd = pabc * innerP[d];
          for (let e = 0; e < OUTER_SYMS.length; e++) {
            line[4] = OUTER_SYMS[e];
            const { pay } = linePay(line, table);
            if (pay > 0) ev += pd * outerP[e] * pay;
          }
        }
      }
    }
  }
  return ev;
}

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const binom = (n: number, k: number, p: number) => choose(n, k) * p ** k * (1 - p) ** (n - k);

export const P_KEY_OUTER = OUTER_W[9] / WEIGHT_TOTAL;
export const P_KEY_INNER = INNER_W[KEY] / WEIGHT_TOTAL;
export const P_SCATTER = INNER_W[SCATTER] / WEIGHT_TOTAL;

/** P(at least 3 scatters in the 12 inner cells): a paid or free spin awards (or re-awards) spins. */
export const pScatter3 = () => 1 - [0, 1, 2].reduce((s, k) => s + binom(12, k, P_SCATTER), 0);
/** P(a spin opens the lock): a full outer column on either side. */
export const pLock = () => 1 - (1 - P_KEY_OUTER ** 3) ** 2;
/** P(a given inner cell is locked after r respins). */
export const pCellLocked = (r: number) => 1 - (1 - P_KEY_INNER) ** r;

/** Value of a lock with h cells held and r respins left: E[LOCK_PAY[final count]]. */
export function lockValue(h: number, r: number): number {
  const p = pCellLocked(r);
  let v = 0;
  for (let j = 0; j <= LOCK_CELLS - h; j++) v += binom(LOCK_CELLS - h, j, p) * LOCK_PAY[h + j];
  return v;
}
/** Distribution of the final locked count from (h, r): index = count. */
export function lockDistribution(h: number, r: number): number[] {
  const p = pCellLocked(r);
  const d = new Array<number>(LOCK_CELLS + 1).fill(0);
  for (let j = 0; j <= LOCK_CELLS - h; j++) d[h + j] = binom(LOCK_CELLS - h, j, p);
  return d;
}

/** EN(awarded, remaining): expected free spins still to be played, with the cap (DP, memoised). */
const enMemo = new Map<number, number>();
export function expectedFreeSpins(awardedSoFar: number, remaining: number): number {
  if (remaining <= 0) return 0;
  const key = awardedSoFar * 1000 + remaining;
  const hit = enMemo.get(key);
  if (hit !== undefined) return hit;
  const q = pScatter3();
  const a = Math.min(FREE_AWARD, FREE_CAP - awardedSoFar);
  const v = 1 + q * expectedFreeSpins(awardedSoFar + a, remaining - 1 + a) + (1 - q) * expectedFreeSpins(awardedSoFar, remaining - 1);
  enMemo.set(key, v);
  return v;
}

export interface Rtp {
  lineBase: number;
  lineFree: number;
  q: number;
  t: number;
  eLock: number;
  n: number;
  base: number;
  rtp: number;
}

let cached: Rtp | null = null;
/** The exact RTP and its parts (computed once, about 50 ms). */
export function rtpParts(): Rtp {
  if (cached) return cached;
  const lineBase = lineEv(PAY_BASE);
  const lineFree = lineEv(PAY_FREE);
  const q = pScatter3();
  const t = pLock();
  const eLock = lockValue(0, LOCK_RESPINS);
  const n = expectedFreeSpins(FREE_AWARD, FREE_AWARD);
  const base = LINES * lineBase + t * eLock;
  const rtp = base + q * n * (LINES * lineFree + t * eLock);
  cached = { lineBase, lineFree, q, t, eLock, n, base, rtp };
  return cached;
}

export const RTP = rtpParts().rtp;

/** Chance a paid spin opens a feature (free spins, lock or both): the one number shown. */
export const featureChance = () => 1 - (1 - pScatter3()) * (1 - pLock());
