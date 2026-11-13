// Tile Pick: 30 face-down tiles, pick 1 to 5, every tile flips, you win the
// average of the tiles you picked.
//
// Each of the four difficulties is a table of base multipliers (in whole
// hundredths) with INTEGER weights out of 1,000,000:
//
//   P(item i) = w_i / 1,000,000,   RTP = Σ w_i · cents_i / (100 · 1,000,000).
//
// Every table satisfies Σ w_i = 1,000,000 and Σ w_i · cents_i = 99 · 1,000,000,
// so one tile returns exactly 99%, checked in integers by the tests.
//
// After the bet is placed, 30 independent uniforms are drawn, one per tile;
// tile t shows item itemIndex(u_t, d). The tiles are i.i.d., so WHICH tiles you
// pick cannot change the distribution (the unpicked tiles are real draws that
// carry no information). With n picks the payout multiplier is the average of
// the base multipliers under the picked tiles:
//
//   payout = (Σ_{picked} cents) / (100 · n),   E[payout] = E[m] = 0.99,
//
// by linearity, for every n and every difficulty: the number of picks only
// lowers the volatility (σ/√n), never the RTP. Each tile prints base/n, so the
// payout is the plain sum of the picked tiles. There is no cash-out and no
// decision after the bet, so the only freedom is between bets.
//
// Max payout 3,000× (Expert's top item; an average never exceeds its top item).

export const RTP = 0.99;
export const WEIGHT_TOTAL = 1_000_000;
export const TILE_COUNT = 30;
export const COLS = 5;
export const MAX_PICKS = 5;
export const PICK_COUNTS = [1, 2, 3, 4, 5] as const;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export interface Item {
  /** Base multiplier in hundredths (integer). */
  cents: number;
  mult: number;
  /** Integer weight out of WEIGHT_TOTAL. */
  weight: number;
  /** Exact chance. */
  p: number;
}

// [base multiplier in cents, weight out of 1,000,000], lowest payout first.
const TABLES: Record<Difficulty, readonly (readonly [number, number])[]> = {
  easy: [
    [40, 156_500],
    [80, 425_500],
    [100, 250_000],
    [150, 100_000],
    [200, 50_000],
    [400, 15_000],
    [900, 3_000],
  ],
  medium: [
    [30, 406_750],
    [70, 264_250],
    [120, 200_000],
    [200, 90_000],
    [500, 30_000],
    [1_000, 8_000],
    [3_300, 1_000],
  ],
  hard: [
    [10, 52_475],
    [50, 761_305],
    [150, 120_000],
    [400, 50_000],
    [1_000, 15_000],
    [5_000, 1_200],
    [70_500, 20],
  ],
  expert: [
    [0, 277_844],
    [50, 574_000],
    [200, 120_000],
    [1_000, 25_000],
    [5_000, 3_000],
    [30_000, 150],
    [300_000, 6],
  ],
};

export const TABLE: Record<Difficulty, readonly Item[]> = Object.fromEntries(
  DIFFICULTIES.map((d) => [d, TABLES[d].map(([cents, weight]) => ({ cents, mult: cents / 100, weight, p: weight / WEIGHT_TOTAL }))]),
) as unknown as Record<Difficulty, readonly Item[]>;

/** Σ w·cents: equals 99 · WEIGHT_TOTAL exactly when the table returns 99%. */
export const weightedCents = (d: Difficulty) => TABLE[d].reduce((s, it) => s + it.weight * it.cents, 0);
export const rtpOf = (d: Difficulty) => weightedCents(d) / (100 * WEIGHT_TOTAL);
export const topItem = (d: Difficulty) => TABLE[d][TABLE[d].length - 1];
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map((d) => topItem(d).mult));

/** The item index for a uniform u in [0, 1): k = floor(u·W) falls in item i's cumulative-weight interval. */
export function itemIndex(u: number, d: Difficulty): number {
  const items = TABLE[d];
  const k = Math.min(WEIGHT_TOTAL - 1, Math.floor(u * WEIGHT_TOTAL));
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].weight;
    if (k < acc) return i;
  }
  return items.length - 1;
}

export interface RoundResult {
  /** Item index shown on each of the 30 tiles. */
  tiles: number[];
  /** Payout multiplier on the whole stake: the average of the picked items. */
  multiplier: number;
}

/** One bet: 30 draws (one per tile), then the average of the picked tiles. `picks` are distinct tile indices. */
export function playRound(next: () => number, d: Difficulty, picks: readonly number[]): RoundResult {
  const tiles: number[] = [];
  for (let t = 0; t < TILE_COUNT; t++) tiles.push(itemIndex(next(), d));
  let cents = 0;
  for (const t of picks) cents += TABLE[d][tiles[t]].cents;
  return { tiles, multiplier: cents / (100 * picks.length) };
}

/** `count` distinct tile indices, in order, by a partial Fisher-Yates shuffle driven by `int(n)`. */
export function randomPicks(int: (n: number) => number, count: number): number[] {
  const pool = Array.from({ length: TILE_COUNT }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + int(TILE_COUNT - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/** The exact distribution of the payout for n picks (keyed by the sum of cents), by enumerating all 7^n tuples. */
const distCache = new Map<string, Map<number, number>>();
export function roundDistribution(d: Difficulty, n: number): Map<number, number> {
  const key = `${d}:${n}`;
  const hit = distCache.get(key);
  if (hit) return hit;
  let dist = new Map<number, number>([[0, 1]]);
  for (let r = 0; r < n; r++) {
    const nx = new Map<number, number>();
    for (const [s, p] of dist) for (const it of TABLE[d]) nx.set(s + it.cents, (nx.get(s + it.cents) ?? 0) + p * it.p);
    dist = nx;
  }
  distCache.set(key, dist);
  return dist;
}

/** Exact RTP for n picks (enumerated, not assumed). */
export function roundRtp(d: Difficulty, n: number): number {
  let ev = 0;
  for (const [s, p] of roundDistribution(d, n)) ev += p * (s / (100 * n));
  return ev;
}

/** Exact chance the bet pays more than the stake. */
export function profitChance(d: Difficulty, n: number): number {
  let p = 0;
  for (const [s, q] of roundDistribution(d, n)) if (s > 100 * n) p += q;
  return p;
}

/** Exact chance the bet pays less than the stake / exactly the stake. */
export function lossChance(d: Difficulty, n: number): number {
  let p = 0;
  for (const [s, q] of roundDistribution(d, n)) if (s < 100 * n) p += q;
  return p;
}

/** Standard deviation of the payout multiplier (one tile's σ over √n). */
export function stdDev(d: Difficulty, n: number): number {
  const items = TABLE[d];
  const m = items.reduce((s, it) => s + it.p * it.mult, 0);
  const v = items.reduce((s, it) => s + it.p * (it.mult - m) ** 2, 0);
  return Math.sqrt(v / n);
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(d: Difficulty, n: number): Volatility {
  const sd = stdDev(d, n);
  return sd < 1 ? 'low' : sd < 3 ? 'medium' : sd < 6 ? 'high' : 'extreme';
}

/** What one tile prints: its base multiplier divided by the number of picks. */
export const tileValue = (d: Difficulty, item: number, n: number) => TABLE[d][item].mult / Math.max(1, n);
