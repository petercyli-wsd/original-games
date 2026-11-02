// Probe: a ring of m equal slots. Balls drop one at a time; each lands on a
// uniformly random slot and, if that slot is full, slides clockwise to the
// first empty one. A ball that would have to slide more than P slots busts
// the round. Place K balls and the round pays out. (This is linear probing
// in a hash table: balls are keys, the landing slot is the hash, the slide is
// the probe distance.)
//
// The game fixes m = 24 and P = 1 and offers one knob, the number of balls K.
// With P = 1 a ball busts exactly when it lands on a full slot whose clockwise
// neighbour is also full.
//
// The risk, as a picture. A ball landing on h busts exactly when h and the
// next P slots are all full. In a run of c full slots that is true of the
// first c − P slots, so the red slots number Σ max(0, c − P) over the runs,
// and the bust chance of the next ball is q = red / m: the share of the ring
// that is red. Runs only grow, and when a ball fills the single gap between
// two runs they merge and the red count jumps (Knuth's "primary clustering").
//
// Pricing (per-step fair factor). Surviving a ball with bust chance q
// multiplies the cash-out by 1/(1 − q) = m / (m − red), so
//   E[cash-out after the ball] = (1 − q)·cash/(1 − q) + q·0 = cash.
// The cash-out is a martingale starting at RTP; every round ends within K
// balls, so by optional stopping every strategy (any cash-out rule, playing
// to the end, the automatic placing of balls that can't bust) returns exactly
// RTP. Balls with q = 0 are free and q = 1 never happens (an empty slot is
// never red).
//
// Max multiplier, honestly bounded without a cap. With n balls placed, the
// red count is at most n − P (all balls in one run), so the factor of the
// next ball is at most m / (m − n + P) and the payout at most
//   RTP · Π_{n=P+1}^{K−1} m / (m − n + P),
// which is reached by the path that keeps a single growing run. The largest
// over the ball counts on offer is the manifest's maxMultiplier.
//
// Headline odds (exact). Write f_P(c) for the number of landing sequences of
// c balls into a block of c slots that fill it without spilling out of its
// end and with every slide ≤ P. Splitting on the slot j the last ball fills
// gives
//   f_P(c) = Σ_j C(c−1, j) · f_P(j) · f_P(c−1−j) · (min(j, P) + 1),
// and with no limit f(c) = (c + 1)^(c−1), the parking functions. On the ring,
// the final board has e = m − K empty slots and splits into e blocks, each a
// run followed by one empty slot; cutting the ring at each empty slot (every
// board is counted e times) gives
//   #good sequences = (m / e) · K! · [x^K] F_P(x)^e,   F_P(x) = Σ f_P(c) x^c / c!,
// and P(win) = #good / m^K. Without a limit F = e^T (T the tree function) and
// the count is m^K, the Konheim–Weiss identity. All of this is BigInt integer
// arithmetic: the headline is an exact rational.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Slots in the ring (fixed). */
export const SLOTS = 24;

/** Max slide (fixed): how many slots a ball may slide past the one it lands on. */
export const MAX_SLIDE = 1;

/** The one knob: balls to place before the round pays out. */
export const BALLS = [6, 10, 14, 18] as const;
export type Balls = (typeof BALLS)[number];

export interface Settings {
  balls: Balls;
}

/** The eval's configs, one per volatility level (one per ball count). */
export const VOLATILITY: Record<Volatility, Settings> = {
  low: { balls: 6 },
  medium: { balls: 10 },
  high: { balls: 14 },
  extreme: { balls: 18 },
};

/** The board: true where a slot holds a ball. */
export type Table = readonly boolean[];

export const emptyTable = (m: number): boolean[] => new Array<boolean>(m).fill(false);

export const ballCount = (table: Table) => table.reduce((n, full) => n + (full ? 1 : 0), 0);

/** How far a ball landing on h slides: slots past h until the first empty one (0 if h is empty). */
export function slideDistance(table: Table, h: number): number {
  const m = table.length;
  let d = 0;
  while (d < m && table[(h + d) % m]) d++;
  return d;
}

/** red[h]: a ball landing on h busts, i.e. h and the next `limit` slots are all full. */
export function redSlots(table: Table, limit: number): boolean[] {
  return table.map((_, h) => slideDistance(table, h) > limit);
}

export const redCount = (table: Table, limit: number) => redSlots(table, limit).filter(Boolean).length;

/** Chance the next ball busts: the red share of the ring. */
export const bustChance = (table: Table, limit: number) => redCount(table, limit) / table.length;

export interface Drop {
  /** Whether the ball found an empty slot within the max slide. */
  safe: boolean;
  /** Slots it slid past where it landed (for a bust: `limit`, where it gave up). */
  hops: number;
  /** Where it ended: its new slot, or the last slot it reached before busting. */
  slot: number;
  /** The board afterwards (unchanged on a bust). */
  table: boolean[];
}

/** Drops a ball that lands on slot h; it slides clockwise at most `limit` slots. */
export function drop(table: Table, h: number, limit: number): Drop {
  const m = table.length;
  const d = slideDistance(table, h);
  if (d > limit) return { safe: false, hops: limit, slot: (h + limit) % m, table: [...table] };
  const next = [...table];
  next[(h + d) % m] = true;
  return { safe: true, hops: d, slot: (h + d) % m, table: next };
}

/** Cash-out after surviving a ball that had `red` red slots out of m. */
export const afterSafeBall = (cash: number, red: number, m: number) => (cash * m) / (m - red);

export interface Cluster {
  start: number;
  length: number;
}

/** Maximal runs of full slots (a board with an empty slot has a well-defined start for each). */
export function clusters(table: Table): Cluster[] {
  const m = table.length;
  const start = table.findIndex((full) => !full);
  if (start < 0) return [{ start: 0, length: m }];
  const out: Cluster[] = [];
  let run = 0;
  for (let i = 1; i <= m; i++) {
    const s = (start + i) % m;
    if (table[s]) run++;
    else if (run > 0) {
      out.push({ start: (s - run + m) % m, length: run });
      run = 0;
    }
  }
  return out;
}

// ---------- Exact headline: parking functions with a max slide ----------

function binomials(n: number): bigint[][] {
  const C: bigint[][] = [];
  for (let i = 0; i <= n; i++) {
    C.push([]);
    for (let j = 0; j <= i; j++) C[i].push(j === 0 || j === i ? 1n : C[i - 1][j - 1] + C[i - 1][j]);
  }
  return C;
}

/** f_P(c) for c = 0..cmax: landing sequences that fill a block of c slots exactly, every slide ≤ limit. */
export function blockCounts(limit: number, cmax: number): bigint[] {
  const C = binomials(Math.max(cmax, 1));
  const f: bigint[] = [1n];
  for (let c = 1; c <= cmax; c++) {
    let s = 0n;
    for (let j = 0; j < c; j++) s += C[c - 1][j] * f[j] * f[c - 1 - j] * BigInt(Math.min(j, limit) + 1);
    f.push(s);
  }
  return f;
}

/** Number of landing sequences (out of m^K) that place K balls in m slots with every slide ≤ limit. */
export function fillCount(m: number, K: number, limit: number): bigint {
  if (K <= 0) return 1n;
  const e = m - K;
  if (e < 1) throw new Error('need at least one empty slot');
  const f = blockCounts(limit, K);
  const C = binomials(K);
  // g[n] = n! [x^n] F^t, built up for t = 1..e.
  let g: bigint[] = [1n, ...new Array<bigint>(K).fill(0n)];
  for (let t = 1; t <= e; t++) {
    const h: bigint[] = [];
    for (let n = 0; n <= K; n++) {
      let s = 0n;
      for (let c = 0; c <= n; c++) s += C[n][c] * f[c] * g[n - c];
      h.push(s);
    }
    g = h;
  }
  const total = BigInt(m) * g[K];
  if (total % BigInt(e) !== 0n) throw new Error('ring count is not an integer');
  return total / BigInt(e);
}

const fillCache = new Map<string, number>();

/** Exact chance that K balls all fit within the max slide, from an empty board. */
export function fillChance(m: number, K: number, limit: number): number {
  const key = `${m}/${K}/${limit}`;
  let p = fillCache.get(key);
  if (p === undefined) {
    p = Number(fillCount(m, K, limit)) / Number(BigInt(m) ** BigInt(K));
    fillCache.set(key, p);
  }
  return p;
}

// ---------- Bounds and volatility ----------

/** Largest payout reachable with these settings: one run that grows with every ball. */
export function maxMultiplier(m: number, K: number, limit: number): number {
  let x = RTP;
  for (let n = limit + 1; n < K; n++) x *= m / (m - n + limit);
  return x;
}

export const MAX_MULTIPLIER = Math.max(...BALLS.map((K) => maxMultiplier(SLOTS, K, MAX_SLIDE)));

/** Exact chance to place all K balls on the game's ring. */
export const winChance = (balls: number) => fillChance(SLOTS, balls, MAX_SLIDE);

/** Volatility label for a ball count: one level per option, from low (fewest) to extreme. */
export function volatilityOf(balls: Balls): Volatility {
  return (['low', 'medium', 'high', 'extreme'] as const)[BALLS.indexOf(balls)];
}
