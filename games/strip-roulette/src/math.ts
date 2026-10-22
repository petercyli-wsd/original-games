// Strip Roulette (the horizontal colour-strip roulette made popular by
// Rollbit's X-Roulette and the CS-style case sites). A strip of N slots
// (N odd) cycles past a fixed pointer: one green slot "0", then red and black
// alternating, so there are h = (N − 1) / 2 reds and h blacks. One slot is
// drawn uniformly: slot = floor(u · N).
//
// Bets (any combination per spin, each with its own stake):
//   Red    covers the h red slots          P = h / N   pays RTP · N / h
//   Black  covers the h black slots        P = h / N   pays RTP · N / h
//   Green  covers the single green slot    P = 1 / N   pays RTP · N
//   Edge   covers the two slots that flank the green (one red, one black)
//                                          P = 2 / N   pays RTP · N / 2
//
// Every bet covers k of the N slots and pays RTP · N / k, so its expected
// return is (k / N) · RTP · N / k = RTP exactly, whatever k is. A layout is a
// sum of independent bets on the same draw, so by linearity of expectation
// any layout returns exactly RTP = 99% of its total stake. Tests verify this
// by enumerating all N slots for every bet and for random layouts.
//
// Classic strip (N = 15: 7 red, 7 black, 1 green):
//   red / black 0.99 · 15 / 7 = 2.12142857…×, green 0.99 · 15 = 14.85×,
//   edge 0.99 · 15 / 2 = 7.425×.
// The "Strip" knob lengthens the strip to 25, 37 or 55 slots (still one green)
// for a rarer, bigger green: 24.75×, 36.63×, 54.45×. Same 99% on every bet.
//
// Max payout: a layout's payout per unit of total stake is a stake-weighted
// average of the multipliers of the bets that hit, so it never exceeds the
// largest single multiplier, green on the 55-slot strip: 0.99 · 55 = 54.45×.

export const RTP = 0.99;

export const STRIPS = [15, 25, 37, 55] as const;
export type StripSize = (typeof STRIPS)[number];

export const STRIP_NAMES: Record<StripSize, string> = { 15: 'Classic', 25: 'Wide', 37: 'Long', 55: 'Marathon' };

export type Colour = 'red' | 'black' | 'green';
export type BetKey = 'red' | 'green' | 'black' | 'edge';
export const BET_KEYS: BetKey[] = ['red', 'green', 'black', 'edge'];
export const BET_NAMES: Record<BetKey, string> = { red: 'Red', green: 'Green', black: 'Black', edge: 'Edge' };

export type Layout = Record<BetKey, number>;
export const EMPTY_LAYOUT: Layout = { red: 0, green: 0, black: 0, edge: 0 };

export interface Slot {
  colour: Colour;
  /** Printed number: 0 green, reds 1…h, blacks h+1…2h. */
  number: number;
  /** One of the two slots next to the green. */
  edge: boolean;
}

const stripCache = new Map<number, Slot[]>();

/** The strip, one full cycle: green at 0, then red/black alternating; reds are odd positions. */
export function stripOrder(n: number): Slot[] {
  let s = stripCache.get(n);
  if (s) return s;
  const h = (n - 1) / 2;
  s = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) s.push({ colour: 'green', number: 0, edge: false });
    else if (i % 2 === 1) s.push({ colour: 'red', number: (i + 1) / 2, edge: i === 1 || i === n - 1 });
    else s.push({ colour: 'black', number: h + i / 2, edge: i === 1 || i === n - 1 });
  }
  stripCache.set(n, s);
  return s;
}

/** Whether a bet wins when the strip stops on slot index i. */
export function covers(bet: BetKey, i: number, n: number): boolean {
  const slot = stripOrder(n)[i];
  return bet === 'edge' ? slot.edge : slot.colour === bet;
}

/** Number of slots a bet covers. */
export function slotsCovered(bet: BetKey, n: number): number {
  return bet === 'green' ? 1 : bet === 'edge' ? 2 : (n - 1) / 2;
}

/** Win chance of a single bet. */
export const chanceOf = (bet: BetKey, n: number) => slotsCovered(bet, n) / n;

/** Payout multiplier of a single bet: RTP / chance. */
export const payoutOf = (bet: BetKey, n: number) => (RTP * n) / slotsCovered(bet, n);

/** 0.99 � 55, written exactly (RTP * 55 is 54.45000000000001 in floating point). */
export const MAX_MULTIPLIER = 54.45;

/** The drawn slot for a uniform u in [0, 1). */
export const drawSlot = (u: number, n: number) => Math.min(n - 1, Math.floor(u * n));

export const totalOf = (layout: Layout) => BET_KEYS.reduce((s, k) => s + layout[k], 0);

/** Amount paid back (stake included) when the strip stops on slot i. */
export function payoutAmount(layout: Layout, n: number, i: number): number {
  let paid = 0;
  for (const k of BET_KEYS) if (layout[k] > 0 && covers(k, i, n)) paid += layout[k] * payoutOf(k, n);
  return paid;
}

/** One spin of a layout: consumes one uniform, returns the slot, payout and multiplier on the total stake. */
export function spin(layout: Layout, n: number, u: number) {
  const slot = drawSlot(u, n);
  const total = totalOf(layout);
  const paid = payoutAmount(layout, n, slot);
  // The min only trims floating-point dust (~1e-14) off the green-on-55 payout.
  return { slot, paid, total, multiplier: total > 0 ? Math.min(MAX_MULTIPLIER, paid / total) : 0, winners: BET_KEYS.filter((k) => layout[k] > 0 && covers(k, slot, n)) };
}

export interface LayoutStats {
  /** Exact expected return per unit staked (enumerated over all N slots). */
  rtp: number;
  /** Standard deviation of the multiplier on the total stake. */
  sd: number;
  /** P(at least one of the bets hits). */
  pHit: number;
  /** P(payout exceeds the total stake). */
  pProfit: number;
  /** Best payout multiplier on the total stake. */
  maxMult: number;
}

/** Exact distribution of a layout, by enumerating every slot. */
export function layoutStats(layout: Layout, n: number): LayoutStats {
  const total = totalOf(layout);
  if (!(total > 0)) return { rtp: RTP, sd: 0, pHit: 0, pProfit: 0, maxMult: 0 };
  let m1 = 0;
  let m2 = 0;
  let hit = 0;
  let profit = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const m = payoutAmount(layout, n, i) / total;
    m1 += m;
    m2 += m * m;
    if (m > 0) hit++;
    if (m > 1 + 1e-12) profit++;
    max = Math.max(max, m);
  }
  m1 /= n;
  m2 /= n;
  return { rtp: m1, sd: Math.sqrt(Math.max(0, m2 - m1 * m1)), pHit: hit / n, pProfit: profit / n, maxMult: max };
}

export type Vol = 'low' | 'medium' | 'high' | 'extreme';

/** Volatility band of a layout from its standard deviation per unit staked. */
export const volatilityOf = (sd: number): Vol => (sd < 1.5 ? 'low' : sd < 3 ? 'medium' : sd < 6 ? 'high' : 'extreme');

const cents = (x: number) => Math.round(x * 100) / 100;

/**
 * Scales a layout so its total is `target` (to the cent), keeping the
 * proportions. Used by auto-bet's on-win / on-loss stake changes. Rounding
 * error is put on the largest bet so the total is exact.
 */
export function scaleLayout(base: Layout, target: number): Layout {
  const total = totalOf(base);
  if (!(total > 0) || !(target > 0)) return { ...base };
  const f = target / total;
  const out = { ...EMPTY_LAYOUT };
  for (const k of BET_KEYS) out[k] = base[k] > 0 ? Math.max(0.01, cents(base[k] * f)) : 0;
  const diff = cents(cents(target) - totalOf(out));
  if (diff !== 0) {
    const big = BET_KEYS.reduce((a, b) => (out[b] > out[a] ? b : a));
    out[big] = Math.max(0.01, cents(out[big] + diff));
  }
  return out;
}
