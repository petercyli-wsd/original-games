// Cases: one case per bet, drawn from a fixed weighted table (the Stake Cases mechanism).
//
// Each of the four difficulties is a list of items (payout multipliers) with
// INTEGER weights out of 1,000,000, so every chance shown is exact:
//
//   P(item i) = w_i / 1,000,000,   RTP = Σ w_i · m_i / 1,000,000.
//
// The tables are Stake's published ones, value for value (7 / 11 / 15 / 19
// items for Easy / Medium / Hard / Expert). Multipliers are whole hundredths,
// so the RTP is checked in integers: Σ w_i · cents_i = 98 · 1,000,000 for every
// difficulty, i.e. every table returns exactly 98.000%. The four difficulties
// share the RTP and differ only in volatility.
//
// Opening draws one uniform u in [0, 1) from the host RNG; k = ⌊u · 1,000,000⌋
// selects the item whose cumulative-weight interval contains k. The reel that
// scrolls past is decoration: its other items come from a deterministic
// generator seeded by u, never from the RNG, and only the item stopping under
// the marker pays. There is no cash-out and no choice during a round, so the
// pricing is a single step from RTP to the drawn payout (a trivial martingale).
//
// Exact RTP: 98%. Max payout 10,000x (Expert's top item, weight 2 in 1,000,000).

export const RTP = 0.98;
export const WEIGHT_TOTAL = 1_000_000;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export interface Item {
  /** Payout multiplier in hundredths (integer). */
  cents: number;
  /** Payout multiplier. */
  mult: number;
  /** Integer weight out of WEIGHT_TOTAL. */
  weight: number;
  /** Exact chance. */
  p: number;
}

// [multiplier in cents, weight out of 1,000,000], lowest payout first.
const TABLES: Record<Difficulty, readonly (readonly [number, number])[]> = {
  easy: [
    [10, 410_000],
    [40, 350_000],
    [109, 100_000],
    [200, 70_000],
    [300, 40_000],
    [1000, 20_000],
    [2300, 10_000],
  ],
  medium: [
    [0, 300_000],
    [20, 270_000],
    [40, 180_000],
    [150, 130_000],
    [200, 60_000],
    [350, 30_000],
    [750, 15_000],
    [1000, 8_500],
    [1500, 4_000],
    [4100, 1_500],
    [11500, 1_000],
  ],
  hard: [
    [0, 350_000],
    [20, 250_000],
    [40, 120_000],
    [80, 100_000],
    [150, 100_000],
    [300, 50_000],
    [800, 20_000],
    [1000, 4_000],
    [1500, 3_000],
    [3500, 2_000],
    [5000, 400],
    [10000, 300],
    [25000, 150],
    [49500, 100],
    [100000, 50],
  ],
  expert: [
    [0, 353_900],
    [15, 200_000],
    [30, 150_000],
    [70, 150_000],
    [150, 80_000],
    [500, 30_000],
    [700, 20_000],
    [1000, 8_000],
    [1500, 5_000],
    [2000, 2_000],
    [5000, 400],
    [7500, 300],
    [10000, 200],
    [25000, 100],
    [46000, 50],
    [85000, 30],
    [150000, 12],
    [350000, 6],
    [1000000, 2],
  ],
};

export const CASES: Record<Difficulty, readonly Item[]> = Object.fromEntries(
  DIFFICULTIES.map((d) => [d, TABLES[d].map(([cents, weight]) => ({ cents, mult: cents / 100, weight, p: weight / WEIGHT_TOTAL }))]),
) as unknown as Record<Difficulty, readonly Item[]>;

/** Σ w·cents for a case: equals 99 · WEIGHT_TOTAL exactly when the case returns 99%. */
export const weightedCents = (d: Difficulty) => CASES[d].reduce((s, it) => s + it.weight * it.cents, 0);

/** Exact RTP of one case (a ratio of integers). */
export const rtpOf = (d: Difficulty) => weightedCents(d) / (100 * WEIGHT_TOTAL);

export const topItem = (d: Difficulty) => CASES[d][CASES[d].length - 1];

export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map((d) => topItem(d).mult));

/** The item index for a uniform u ∈ [0, 1): k = ⌊u·W⌋ falls in item i's cumulative-weight interval. */
export function itemIndex(u: number, d: Difficulty): number {
  const items = CASES[d];
  const k = Math.min(WEIGHT_TOTAL - 1, Math.floor(u * WEIGHT_TOTAL));
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].weight;
    if (k < acc) return i;
  }
  return items.length - 1;
}

export interface RoundResult {
  /** Uniform that decided this case (also seeds the decorative reel). */
  u: number;
  /** Index of the item won. */
  index: number;
  /** Payout multiplier on the stake. */
  multiplier: number;
}

/** One bet: one case, one RNG draw. */
export function playRound(next: () => number, d: Difficulty): RoundResult {
  const u = next();
  const index = itemIndex(u, d);
  return { u, index, multiplier: CASES[d][index].mult };
}

/** Exact chance the bet returns more than the stake. */
export function profitChance(d: Difficulty): number {
  return CASES[d].reduce((s, it) => s + (it.cents > 100 ? it.weight : 0), 0) / WEIGHT_TOTAL;
}

/** Standard deviation of the payout multiplier. */
export function stdDev(d: Difficulty): number {
  const items = CASES[d];
  const m = items.reduce((s, it) => s + it.p * it.mult, 0);
  return Math.sqrt(items.reduce((s, it) => s + it.p * (it.mult - m) ** 2, 0));
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(d: Difficulty): Volatility {
  const sd = stdDev(d);
  return sd < 3.5 ? 'low' : sd < 7 ? 'medium' : sd < 12 ? 'high' : 'extreme';
}

// ---------- Rarity (presentation only) ----------

export type Tier = 'dud' | 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic' | 'legend';
export const TIER_NAMES: Record<Tier, string> = {
  dud: 'Empty',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  mythic: 'Mythic',
  legend: 'Legendary',
};
export function tierOf(mult: number): Tier {
  if (mult <= 0) return 'dud';
  if (mult < 1) return 'common';
  if (mult < 2) return 'uncommon';
  if (mult < 5) return 'rare';
  if (mult < 20) return 'epic';
  if (mult < 100) return 'mythic';
  return 'legend';
}

// ---------- Decorative reel ----------

export const REEL_LENGTH = 52;
/** Where the won item sits on the reel. */
export const WIN_SLOT = 44;
/** Where the reel starts its scroll. */
export const START_SLOT = 3;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The reel strip for one opening: item indices with the won item at WIN_SLOT,
 * plus where inside that card the marker stops (jitter in −0.38…0.38 card
 * widths). The filler items are decoration drawn from a flattened (√weight)
 * distribution, so rare items scroll past now and then; they are seeded from
 * u and never consume the game RNG.
 */
export function reelFor(d: Difficulty, winIndex: number, seed: number): { strip: number[]; jitter: number } {
  const rand = mulberry32(Math.floor(seed * 4294967296) ^ 0x5bd1e995);
  const items = CASES[d];
  const flat = items.map((it) => Math.sqrt(it.weight));
  const total = flat.reduce((a, b) => a + b, 0);
  const pick = () => {
    let x = rand() * total;
    for (let i = 0; i < flat.length; i++) if ((x -= flat[i]) < 0) return i;
    return flat.length - 1;
  };
  const strip = Array.from({ length: REEL_LENGTH }, (_, i) => (i === WIN_SLOT ? winIndex : pick()));
  return { strip, jitter: (rand() - 0.5) * 0.76 };
}
