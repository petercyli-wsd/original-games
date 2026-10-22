// Cases (the case-opening format seen on Stake and the CS-style case sites).
//
// A case is a discrete prize distribution. Each of the four difficulties is a
// list of items (payout multipliers) with INTEGER weights out of 100,000, so
// every chance shown on screen is exact to the thousandth of a percent:
//
//   P(item i) = w_i / 100,000,   RTP = Σ w_i · m_i / 100,000.
//
// Multipliers are whole hundredths (cents), so the RTP is checked with integer
// arithmetic, not floats:  Σ w_i · cents_i = 99 · 100,000  for every case,
// i.e. every case returns exactly 99.000%.
//
// Opening draws one uniform u ∈ [0, 1) from the host RNG; k = ⌊u · 100,000⌋
// selects the item whose cumulative-weight interval contains k. The reel that
// scrolls past is decoration: its other items come from a deterministic
// generator seeded by u, never from the RNG, and only the item stopping under
// the marker pays.
//
// "Cases per bet" (1–4) splits the stake evenly over n independent openings
// of the same case. The payout multiplier is the average of the n items:
//
//   E[ (m_1 + … + m_n) / n ] = E[m] = 0.99,
//
// by linearity, so the case count only lowers the volatility (σ/√n), never
// the RTP. Tests confirm it by exact enumeration of all n-tuples.
//
// Exact RTP: 99% for every difficulty and every case count. Max payout 1,000×
// (Expert's top item; the average of n items can never exceed the top item).

export const RTP = 0.99;
export const WEIGHT_TOTAL = 100_000;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export const CASE_COUNTS = [1, 2, 3, 4] as const;
export type CaseCount = (typeof CASE_COUNTS)[number];

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

// [multiplier in cents, weight out of 100,000], lowest payout first.
const TABLES: Record<Difficulty, readonly (readonly [number, number])[]> = {
  easy: [
    [40, 9_600],
    [70, 48_800],
    [110, 25_000],
    [140, 10_000],
    [200, 4_000],
    [300, 1_500],
    [500, 800],
    [1_000, 300],
  ],
  medium: [
    [20, 30_750],
    [50, 35_900],
    [120, 22_000],
    [200, 7_000],
    [400, 3_000],
    [1_000, 1_000],
    [2_500, 300],
    [10_000, 50],
  ],
  hard: [
    [10, 44_776],
    [60, 34_204],
    [150, 14_000],
    [300, 5_000],
    [800, 1_500],
    [2_500, 400],
    [8_000, 100],
    [40_000, 20],
  ],
  expert: [
    [0, 62_130],
    [30, 23_000],
    [200, 9_800],
    [500, 3_500],
    [1_500, 1_200],
    [5_000, 300],
    [20_000, 60],
    [100_000, 10],
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

export interface Opening {
  /** Uniform that decided this case (also seeds the decorative reel). */
  u: number;
  /** Index of the item won. */
  index: number;
  mult: number;
}

export interface RoundResult {
  openings: Opening[];
  /** Payout multiplier on the whole stake: the average of the items won. */
  multiplier: number;
}

/** One bet: n openings of the same case, one RNG draw each. */
export function playRound(next: () => number, d: Difficulty, n: number): RoundResult {
  const openings: Opening[] = [];
  let cents = 0;
  for (let r = 0; r < n; r++) {
    const u = next();
    const index = itemIndex(u, d);
    const it = CASES[d][index];
    cents += it.cents;
    openings.push({ u, index, mult: it.mult });
  }
  return { openings, multiplier: cents / (100 * n) };
}

/**
 * The exact distribution of the round's payout for n cases, by enumerating
 * every n-tuple of items (at most 8⁴ = 4,096). Keyed by the sum of cents.
 */
const distCache = new Map<string, Map<number, number>>();
export function roundDistribution(d: Difficulty, n: number): Map<number, number> {
  const key = `${d}:${n}`;
  const hit = distCache.get(key);
  if (hit) return hit;
  let dist = new Map<number, number>([[0, 1]]);
  for (let r = 0; r < n; r++) {
    const next = new Map<number, number>();
    for (const [s, p] of dist) for (const it of CASES[d]) next.set(s + it.cents, (next.get(s + it.cents) ?? 0) + p * it.p);
    dist = next;
  }
  distCache.set(key, dist);
  return dist;
}

/** Exact RTP of a bet on n cases (enumerated, not assumed). */
export function roundRtp(d: Difficulty, n: number): number {
  let ev = 0;
  for (const [s, p] of roundDistribution(d, n)) ev += p * (s / (100 * n));
  return ev;
}

/** Exact chance the bet returns more than the stake. */
export function profitChance(d: Difficulty, n: number): number {
  let p = 0;
  for (const [s, q] of roundDistribution(d, n)) if (s > 100 * n) p += q;
  return p;
}

/** Standard deviation of the payout multiplier (σ of one case over √n). */
export function stdDev(d: Difficulty, n: number): number {
  const items = CASES[d];
  const m = items.reduce((s, it) => s + it.p * it.mult, 0);
  const v = items.reduce((s, it) => s + it.p * (it.mult - m) ** 2, 0);
  return Math.sqrt(v / n);
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';
export function volatilityOf(d: Difficulty, n: number): Volatility {
  const sd = stdDev(d, n);
  return sd < 1.5 ? 'low' : sd < 5 ? 'medium' : sd < 9 ? 'high' : 'extreme';
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
