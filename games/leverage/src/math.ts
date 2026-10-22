// Leverage (the 1000× trading format popularised by Rollbit): bet that a
// SIMULATED price goes Up or Down, with leverage L from 2× to 1000×. No real
// market data is used anywhere; the price is a fair random walk drawn from the
// game's RNG.
//
// The lattice. For leverage L the price moves in ticks of exactly
//
//     δ = 1 / (L·n)  of the entry price,   n = round(10 000 / L)  (n ≥ 10),
//
// so a tick is about one basis point (0.01%) for every L, and the bust price,
// entry·(1 ∓ 1/L), is exactly n ticks away. Each tick the price goes one tick
// up or one tick down with probability ½ each (u < ½ is up): a mean-zero,
// driftless walk, so the price itself is a martingale.
//
// The position. Opening costs a 1% fee, so the margin is RTP·stake with
// RTP = 0.99, and the position is worth
//
//     V = RTP · stake · (1 + L·r) = RTP · stake · (1 + k/n),
//
// where r is the price return in the player's direction and k the number of
// ticks in the player's favour. Every tick moves V by exactly RTP·stake/n, and
// V hits 0 exactly when k = −n: the walk lands ON the bust level, never past
// it, so there is no clamped overshoot that could leak value to the player.
//
// RTP. k is a simple symmetric random walk, so V is a martingale: E[V after a
// tick | now] = V now. Every way of closing – a click at any moment, take
// profit, stop loss, the expiry clock, or busting – is a stopping time bounded
// by the expiry, so by optional stopping every strategy returns exactly
// E[V_0] = RTP = 99% of the stake. Leverage, direction, take profit, stop loss
// and expiry change only the volatility.
//
// Odds on screen. The chances shown (take profit, profit, stop/bust, expiry)
// are computed exactly by dynamic programming over the walk's remaining ticks
// (`odds`), never by simulation. With no clock they reduce to gambler's ruin:
// P(reach +b before −a) = a/(a+b).
//
// Max win. k ≤ ticks elapsed ≤ T (the expiry, at most 60 s · 25 ticks/s =
// 1500 ticks) and n ≥ 10, so V/stake ≤ 0.99·(1 + 1500/10) = 149.49×.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const MIN_LEVERAGE = 2;
export const MAX_LEVERAGE = 1000;
/** Ticks per 100% of the entry price: one tick ≈ 1 basis point. */
export const BASE_TICKS = 10_000;
/** Market ticks per second of real time (Turbo runs the clock faster). */
export const TICK_HZ = 25;
export const TICK_MS = 1000 / TICK_HZ;
/** Expiry options in seconds. */
export const EXPIRIES = [10, 30, 60] as const;
export type Expiry = (typeof EXPIRIES)[number];

export const ticksFor = (expiry: Expiry) => expiry * TICK_HZ;
export const MAX_TICKS = ticksFor(60);
export const MIN_N = Math.round(BASE_TICKS / MAX_LEVERAGE);
export const MAX_MULTIPLIER = RTP * (1 + MAX_TICKS / MIN_N);

/** Up = profit when the price rises, Down = profit when it falls. */
export type Direction = 'up' | 'down';
export const sign = (d: Direction) => (d === 'up' ? 1 : -1);

export const clampLeverage = (x: number) => (Number.isFinite(x) ? Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.round(x))) : 100);

/** Ticks from entry to the bust price. */
export const bustTicks = (lev: number) => Math.round(BASE_TICKS / clampLeverage(lev));

/** Size of one price tick, as a fraction of the entry price. */
export const tickSize = (lev: number) => 1 / (clampLeverage(lev) * bustTicks(lev));

/** Position value (multiple of the stake) after k ticks in the player's favour. */
export const valueAt = (k: number, n: number) => (k <= -n ? 0 : RTP * (1 + k / n));

/** Price after k ticks in the player's favour. */
export const priceAt = (entry: number, lev: number, dir: Direction, k: number) => entry * (1 + (sign(dir) * k) / (clampLeverage(lev) * bustTicks(lev)));

/** The bust (liquidation) price: where the loss equals the margin. */
export const bustPrice = (entry: number, lev: number, dir: Direction) => entry * (1 - sign(dir) / clampLeverage(lev));

/** Typed take-profit / stop-loss limits. */
export const MIN_TP = 1.01;
export const MAX_SL = 0.98;
export const MIN_SL = 0.01;

/** Take-profit barrier in ticks: the first lattice value at or above `tp`. */
export function tpTicks(tp: number | null, n: number): number | null {
  if (tp === null || !(tp > RTP)) return null;
  return Math.max(1, Math.ceil(n * (tp / RTP - 1) - 1e-9));
}

/** Stop-loss barrier in ticks: the first lattice value at or below `sl`; −n (bust) when off. */
export function slTicks(sl: number | null, n: number): number {
  if (sl === null || !(sl > 0)) return -n;
  const a = Math.floor(n * (sl / RTP - 1) + 1e-9);
  return Math.max(-n, Math.min(-1, a));
}

export interface Setup {
  lev: number;
  dir: Direction;
  expiry: Expiry;
  tp: number | null;
  sl: number | null;
}

export interface Barriers {
  /** Ticks to bust. */
  n: number;
  /** Lower barrier (stop loss, or −n = bust). */
  lo: number;
  /** Upper barrier (take profit), or null. */
  hi: number | null;
  /** Ticks until expiry. */
  T: number;
}

export function barriersOf(s: Setup): Barriers {
  const n = bustTicks(s.lev);
  return { n, lo: slTicks(s.sl, n), hi: tpTicks(s.tp, n), T: ticksFor(s.expiry) };
}

/** One market tick: +1 (in the player's favour) when u < ½, else −1. */
export const tickMove = (u: number) => (u < 0.5 ? 1 : -1);

export type Outcome = 'tp' | 'sl' | 'bust' | 'expired' | 'closed';

/** Which barrier (if any) the walk sits on. */
export function barrierHit(k: number, b: Barriers): Outcome | null {
  if (k <= -b.n) return 'bust';
  if (k <= b.lo) return 'sl';
  if (b.hi !== null && k >= b.hi) return 'tp';
  return null;
}

export interface Odds {
  /** P(take profit is hit before the stop and the clock). */
  tp: number;
  /** P(the stop loss or bust level is hit first). */
  lo: number;
  /** P(the clock runs out first). */
  expire: number;
  /** P(the position closes worth more than the stake). */
  profit: number;
  /** P(it expires in profit) – part of `profit`. */
  expireProfit: number;
  /** Exact expected value (multiple of stake) of holding to the end: equals the value now. */
  ev: number;
}

let bufA = new Float64Array(0);
let bufB = new Float64Array(0);

/**
 * Exact odds of holding from k with r ticks left until the take profit, the
 * stop (or bust) or the clock, by dynamic programming over the walk. O(r²) at
 * worst (≈2 ms for r = 1500); callers cache or throttle it.
 */
export function odds(k0: number, b: Barriers, r: number): Odds {
  const v = (k: number) => valueAt(k, b.n);
  const hit = barrierHit(k0, b);
  if (hit || r <= 0) {
    const val = v(k0);
    const p = val > 1 ? 1 : 0;
    return {
      tp: hit === 'tp' ? 1 : 0,
      lo: hit === 'sl' || hit === 'bust' ? 1 : 0,
      expire: hit ? 0 : 1,
      profit: p,
      expireProfit: hit ? 0 : p,
      ev: val,
    };
  }
  const lo = Math.max(b.lo, k0 - r - 1);
  const hi = b.hi === null ? k0 + r + 1 : Math.min(b.hi, k0 + r + 1);
  const hiIsTp = b.hi !== null && hi === b.hi;
  const loIsBarrier = lo === b.lo;
  const w = hi - lo + 1;
  if (bufA.length < w) {
    bufA = new Float64Array(w);
    bufB = new Float64Array(w);
  }
  let cur = bufA;
  let nxt = bufB;
  cur.fill(0, 0, w);
  nxt.fill(0, 0, w);
  cur[k0 - lo] = 1;
  let pHi = 0;
  let pLo = 0;
  for (let s = 1; s <= r; s++) {
    // Mass sits on k0 ± (s−1) with the parity of s−1, strictly inside (lo, hi).
    const from = Math.max(lo + 1, k0 - s + 1);
    const to = Math.min(hi - 1, k0 + s - 1);
    for (let k = from; k <= to; k++) {
      const m = cur[k - lo];
      if (m === 0) continue;
      cur[k - lo] = 0;
      const h = m * 0.5;
      if (k + 1 === hi) pHi += h;
      else nxt[k + 1 - lo] += h;
      if (k - 1 === lo) pLo += h;
      else nxt[k - 1 - lo] += h;
    }
    const t = cur;
    cur = nxt;
    nxt = t;
  }
  // Barriers that the clock keeps out of reach are never hit.
  if (!hiIsTp) pHi = 0;
  if (!loIsBarrier) pLo = 0;
  let expire = 0;
  let expireProfit = 0;
  let ev = (hiIsTp ? pHi * v(hi) : 0) + (loIsBarrier ? pLo * v(lo) : 0);
  for (let k = lo + 1; k <= hi - 1; k++) {
    const m = cur[k - lo];
    if (m === 0) continue;
    cur[k - lo] = 0;
    expire += m;
    ev += m * v(k);
    if (v(k) > 1) expireProfit += m;
  }
  const tpVal = hiIsTp ? v(hi) : 0;
  const loVal = loIsBarrier ? v(lo) : 0;
  const profit = expireProfit + (tpVal > 1 ? pHi : 0) + (loVal > 1 ? pLo : 0);
  return { tp: pHi, lo: pLo, expire, profit, expireProfit, ev };
}

/** Cheap exact odds cache for the idle preview (keyed by the barriers). */
const cache = new Map<string, Odds>();
export function startOdds(b: Barriers): Odds {
  const key = `${b.n}|${b.lo}|${b.hi}|${b.T}`;
  let o = cache.get(key);
  if (!o) {
    o = odds(0, b, b.T);
    if (cache.size > 200) cache.clear();
    cache.set(key, o);
  }
  return o;
}

/** Standard deviation of the value (multiple of stake) of holding to expiry with no limits: the volatility hint. */
export const spread = (lev: number, expiry: Expiry) => (RTP * Math.sqrt(ticksFor(expiry))) / bustTicks(lev);

export function volatilityOf(lev: number, expiry: Expiry): Volatility {
  const sd = spread(lev, expiry);
  return sd < 0.1 ? 'low' : sd < 0.4 ? 'medium' : sd < 1.5 ? 'high' : 'extreme';
}

export interface Played {
  outcome: Outcome;
  k: number;
  ticks: number;
  multiplier: number;
}

/**
 * Plays one position to its end with the auto rules (take profit, stop loss,
 * expiry), optionally closing by hand after `closeAt` ticks. Used by the
 * Auto mode's maths, the eval and the tests.
 */
export function playPosition(b: Barriers, rng: Rng, closeAt: number | null = null, stop?: (k: number, t: number) => boolean): Played {
  let k = 0;
  for (let t = 1; t <= b.T; t++) {
    k += tickMove(rng.next());
    const hit = barrierHit(k, b);
    if (hit) return { outcome: hit, k, ticks: t, multiplier: valueAt(k, b.n) };
    if ((closeAt !== null && t >= closeAt) || (stop && stop(k, t))) return { outcome: 'closed', k, ticks: t, multiplier: valueAt(k, b.n) };
  }
  return { outcome: 'expired', k, ticks: b.T, multiplier: valueAt(k, b.n) };
}

/** Formats a price with 2 decimals and separators. */
export const fmtPrice = (p: number) => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A signed percentage, e.g. "+0.25%". */
export function fmtSignedPct(x: number, digits = 2) {
  const s = (Math.abs(x) * 100).toFixed(digits);
  return (x > 0 && Number(s) !== 0 ? '+' : x < 0 && Number(s) !== 0 ? '−' : '') + s + '%';
}

/** Leverage presets for the quick chips. */
export const QUICK_LEVERAGE = [2, 10, 50, 100, 500, 1000];

/** Slider position (0–1000) ⇄ leverage, on a log scale. */
export const levFromSlider = (x: number) => clampLeverage(MIN_LEVERAGE * (MAX_LEVERAGE / MIN_LEVERAGE) ** (x / 1000));
export const sliderFromLev = (lev: number) => (1000 * Math.log(clampLeverage(lev) / MIN_LEVERAGE)) / Math.log(MAX_LEVERAGE / MIN_LEVERAGE);
