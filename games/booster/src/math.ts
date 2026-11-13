// Booster: a pack of five cards, each an independent draw from one fixed table.
//
// Every card carries a payout multiplier. The table has 24 multipliers with
// INTEGER weights out of 10,000,000, so each chance shown is exact:
//
//   P(card = m_i) = w_i / 10,000,000.
//
// Multipliers are whole hundredths (cents). The published chances are used
// as they are; the two multipliers with no published chance (75x and 650x)
// are the only free weights, and they are solved so that
//
//   Σ w_i · cents_i = 196,000,000 = 0.196 × 100 × 10,000,000,
//
// i.e. E[card] = μ = 0.196x exactly. A pack pays the SUM of its five cards:
//
//   E[pack] = 5 μ = 0.98 exactly (RTP 98%), by linearity (the cards are independent).
//
// Draw: k = rng.int(10,000,000) picks the card whose cumulative-weight
// interval holds k (an integer draw, so no float-grid bias).
//
// Sell the rest (cash-out). After k cards are open with sum S, the unopened
// cards are worth exactly their expectation:
//
//   V_k = S_k + (5 − k) μ = E[final pack | S_k],  V_0 = 5 μ = 0.98.
//
// E[V_{k+1} | S_k] = S_k + E[m] + (4 − k) μ = V_k, so V is a martingale and,
// by optional stopping, every rule of selling or opening returns exactly
// 0.98. Prices are exact: no simulation anywhere in the game.
//
// Max pack = 5 × 10,000x = 50,000x, so there is no cap to apply.

export const RTP = 0.98;
export const CARDS = 5;
export const WEIGHT_TOTAL = 10_000_000;
/** Expected multiplier of one card, in cents × WEIGHT_TOTAL (exact integer): 0.196x. */
export const MEAN_CARD_SCALED = 196_000_000;
export const MEAN_CARD = MEAN_CARD_SCALED / (100 * WEIGHT_TOTAL);
export const MAX_MULTIPLIER = 5 * 10_000;

export type Tier = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Prime';
export const TIERS: readonly Tier[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Prime'];

export interface Card {
  /** Multiplier in hundredths (integer). */
  cents: number;
  mult: number;
  /** Integer weight out of WEIGHT_TOTAL. */
  weight: number;
  p: number;
  tier: Tier;
  /** Index into TIERS. */
  rank: number;
  /** 1 or 2: the low or high half of the tier. */
  pips: 1 | 2;
}

// [multiplier in cents, weight out of 10,000,000], lowest first.
const RAW: readonly (readonly [number, number])[] = [
  [1, 3_600_000],
  [2, 2_200_000],
  [3, 1_500_000],
  [4, 1_000_000],
  [10, 300_000],
  [15, 300_000],
  [20, 300_000],
  [30, 200_000],
  [50, 200_000],
  [80, 200_000],
  [100, 30_000],
  [120, 30_000],
  [200, 30_000],
  [300, 30_000],
  [400, 30_000],
  [800, 15_000],
  [1_000, 10_000],
  [1_200, 10_000],
  [1_500, 10_000],
  [5_000, 3_000],
  [7_500, 1_200],
  [15_000, 500],
  [50_000, 150],
  [65_000, 100],
  [100_000, 49],
  [1_000_000, 1],
];

export function tierOf(cents: number): { tier: Tier; rank: number; pips: 1 | 2 } {
  if (cents <= 4) return { tier: 'Common', rank: 0, pips: cents <= 2 ? 1 : 2 };
  if (cents <= 80) return { tier: 'Uncommon', rank: 1, pips: cents <= 20 ? 1 : 2 };
  if (cents <= 1_500) return { tier: 'Rare', rank: 2, pips: cents <= 400 ? 1 : 2 };
  if (cents <= 15_000) return { tier: 'Epic', rank: 3, pips: 1 };
  if (cents <= 100_000) return { tier: 'Legendary', rank: 4, pips: 1 };
  return { tier: 'Prime', rank: 5, pips: 1 };
}

export const TABLE: readonly Card[] = RAW.map(([cents, weight]) => ({
  cents,
  mult: cents / 100,
  weight,
  p: weight / WEIGHT_TOTAL,
  ...tierOf(cents),
}));

/** Cumulative weights, for the draw. */
const CUM: number[] = [];
{
  let c = 0;
  for (const { weight } of TABLE) CUM.push((c += weight));
}

/** The card whose cumulative-weight interval holds k (0 ≤ k < WEIGHT_TOTAL). */
export function cardAt(k: number): Card {
  let lo = 0;
  let hi = TABLE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (k < CUM[mid]) hi = mid;
    else lo = mid + 1;
  }
  return TABLE[lo];
}

/** One card, drawn from an integer in [0, 10,000,000). */
export const drawCard = (rng: { int(n: number): number }): Card => cardAt(rng.int(WEIGHT_TOTAL));

/** Sum of the open cards in cents. */
export const sumCents = (cards: readonly Card[]) => cards.reduce((s, c) => s + c.cents, 0);

/** Fair value of a pack with these cards open: sum + (5 − k) × 0.196, as a multiplier of the bet. */
export const packValue = (cards: readonly Card[]) => sumCents(cards) / 100 + (CARDS - cards.length) * MEAN_CARD;

/** The same, from a sum in cents and the number of cards open. */
export const valueOf = (cents: number, open: number) => cents / 100 + (CARDS - open) * MEAN_CARD;

const cache = new Map<string, number>();

/**
 * Exact P(the sum of n fresh cards ≥ need cents): a DP over sums capped at
 * `need` (everything at or above it is one bucket), so it is small and exact.
 */
export function probAtLeast(n: number, need: number): number {
  if (need <= 0) return 1;
  if (n <= 0) return 0;
  const key = `${n}:${need}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let dist = new Float64Array(need + 1);
  dist[0] = 1;
  for (let i = 0; i < n; i++) {
    const next = new Float64Array(need + 1);
    for (let s = 0; s <= need; s++) {
      const ps = dist[s];
      if (ps === 0) continue;
      for (const c of TABLE) next[Math.min(need, s + c.cents)] += ps * c.p;
    }
    dist = next;
  }
  cache.set(key, dist[need]);
  return dist[need];
}

/** Chance the finished pack pays at least the bet (100 cents), given the open cards. */
export const chanceReturnsBet = (cards: readonly Card[]) => probAtLeast(CARDS - cards.length, 100 - sumCents(cards));

/** Exact distribution of the sum of n cards: cents → count out of WEIGHT_TOTAL^n (BigInt). */
export function sumCounts(n: number): Map<number, bigint> {
  let dist = new Map<number, bigint>([[0, 1n]]);
  for (let i = 0; i < n; i++) {
    const next = new Map<number, bigint>();
    for (const [s, c] of dist) for (const card of TABLE) next.set(s + card.cents, (next.get(s + card.cents) ?? 0n) + c * BigInt(card.weight));
    dist = next;
  }
  return dist;
}
