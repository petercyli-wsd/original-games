// Plinko (Stake, Roobet, BC.Game, Rollbit, Shuffle, Rainbet…).
//
// The board has n rows of pegs (8–16). The ball meets one peg per row and goes
// left or right with probability ½ each, independently, so the bucket it lands
// in, k = the number of right bounces, is Binomial(n, ½):
//
//     P(bucket k) = C(n, k) / 2ⁿ,   k = 0 … n.
//
// Each (rows, risk) pair has a symmetric paytable m₀ … mₙ (mₖ = mₙ₋ₖ) with the
// familiar shape: big round prizes at the edges, sub-1× buckets in the middle.
// The RTP is the expectation of the bucket's multiplier,
//
//     RTP(n, risk) = Σₖ C(n, k) · mₖ / 2ⁿ.
//
// Normalisation. The base tables below are written in tenths/hundredths and land
// within ±0.2% of 99%. Round decimals cannot hit 99% exactly in general (the
// middle binomials carry factors such as 7 that no power of ten cancels), so
// one value per table is solved for: the *centre plateau*, the run of equal
// lowest-paying buckets around the middle (one or two buckets on low risk, up to
// five 0.2× buckets on 16-row high). Every plateau bucket pays the same exact
// rational
//
//     m* = (0.99 · 2ⁿ − Σ_{k ∉ plateau} C(n, k)·mₖ) / Σ_{k ∈ plateau} C(n, k),
//
// so Σₖ C(n,k)·mₖ = 0.99·2ⁿ exactly and RTP = 99.00% for all 27 tables. The
// shift from the round base value is under 0.004× in every table (tests check
// this and print each table's exact RTP); the edges and every other bucket
// keep their round values. The tests re-derive the identity in exact integer
// arithmetic (BigInt).
//
// Rows and risk only reshape the distribution (volatility); every setting is
// worth exactly RTP = 0.99 per ball. The path is drawn bounce by bounce from the
// RNG when the ball is dropped, and the animation just follows it.

export const RTP = 0.99;

export type Risk = 'low' | 'medium' | 'high';
export const RISKS: Risk[] = ['low', 'medium', 'high'];
export const MIN_ROWS = 8;
export const MAX_ROWS = 16;
export const ROWS = Array.from({ length: MAX_ROWS - MIN_ROWS + 1 }, (_, i) => MIN_ROWS + i);

/**
 * Base tables, edge to centre (the other half mirrors). For even n the last
 * entry is the single centre bucket; for odd n it is the pair of centre buckets.
 */
const BASE: Record<Risk, Record<number, number[]>> = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5],
    9: [5.6, 2, 1.6, 1, 0.7],
    10: [8.9, 3, 1.4, 1.1, 1, 0.5],
    11: [8.4, 3, 1.9, 1.3, 1, 0.7],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5],
    13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7],
    14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5],
    15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4],
    9: [18, 4, 1.7, 0.9, 0.5],
    10: [22, 5, 2, 1.4, 0.6, 0.4],
    11: [24, 6, 3, 1.8, 0.7, 0.5],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3],
    13: [43, 13, 6, 3, 1.3, 0.7, 0.4],
    14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2],
    15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2],
    9: [43, 7, 2, 0.6, 0.2],
    10: [76, 10, 3, 0.9, 0.3, 0.2],
    11: [120, 14, 5.2, 1.4, 0.4, 0.2],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2],
    13: [260, 37, 11, 4, 1, 0.2, 0.2],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2],
    15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2],
  },
};

/** Exact binomial coefficient (all values here are far below 2⁵³). */
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** The base table expanded to all n + 1 buckets, before normalisation. */
export function baseTable(rows: number, risk: Risk): number[] {
  const half = BASE[risk][rows];
  if (!half) throw new RangeError(`No table for ${rows} rows`);
  const mirror = half.slice(0, rows % 2 === 0 ? half.length - 1 : half.length).reverse();
  return [...half, ...mirror];
}

/** Indices of the centre plateau: the equal lowest buckets around the middle. */
export function plateauOf(rows: number, risk: Risk): number[] {
  const base = baseTable(rows, risk);
  const low = Math.floor(rows / 2);
  const centre = base[low];
  let a = low;
  let b = rows - low;
  while (a > 0 && base[a - 1] === centre) a--;
  while (b < rows && base[b + 1] === centre) b++;
  const out: number[] = [];
  for (let k = a; k <= b; k++) out.push(k);
  return out;
}

/**
 * The plateau value as an exact fraction num/den of integers (multipliers in
 * hundredths): num/den = (99·2ⁿ − Σ_{k∉P} C(n,k)·100·mₖ) / (100 · Σ_{k∈P} C(n,k)).
 */
export function plateauFraction(rows: number, risk: Risk): { num: number; den: number } {
  const base = baseTable(rows, risk);
  const plateau = new Set(plateauOf(rows, risk));
  let rest = 0;
  let weight = 0;
  for (let k = 0; k <= rows; k++) {
    if (plateau.has(k)) weight += binom(rows, k);
    else rest += binom(rows, k) * Math.round(base[k] * 100);
  }
  return { num: 99 * 2 ** rows - rest, den: 100 * weight };
}

export interface Table {
  rows: number;
  risk: Risk;
  /** Payout multiplier for each bucket 0 … rows. */
  mults: number[];
  /** P(bucket k) = C(n, k) / 2ⁿ. */
  probs: number[];
  /** Bucket indices whose value was solved for. */
  plateau: number[];
  /** The round value the plateau had before normalisation. */
  plateauBase: number;
  rtp: number;
  stdDev: number;
  max: number;
  /** P(multiplier ≥ 1). */
  chanceAtLeastEven: number;
  /** P(multiplier > 1): a profit. */
  chanceProfit: number;
}

const cache = new Map<string, Table>();

export function tableFor(rows: number, risk: Risk): Table {
  const key = `${rows}:${risk}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = baseTable(rows, risk);
  const plateau = plateauOf(rows, risk);
  const { num, den } = plateauFraction(rows, risk);
  const m = num / den;
  const mults = base.map((v, k) => (plateau.includes(k) ? m : v));
  const probs = mults.map((_, k) => binom(rows, k) / 2 ** rows);
  let rtp = 0;
  let sq = 0;
  let even = 0;
  let profit = 0;
  for (let k = 0; k <= rows; k++) {
    rtp += probs[k] * mults[k];
    sq += probs[k] * mults[k] ** 2;
    if (mults[k] >= 1) even += probs[k];
    if (mults[k] > 1) profit += probs[k];
  }
  const t: Table = {
    rows,
    risk,
    mults,
    probs,
    plateau,
    plateauBase: base[plateau[0]],
    rtp,
    stdDev: Math.sqrt(Math.max(0, sq - rtp * rtp)),
    max: Math.max(...mults),
    chanceAtLeastEven: even,
    chanceProfit: profit,
  };
  cache.set(key, t);
  return t;
}

export const MAX_MULTIPLIER = Math.max(...RISKS.flatMap((r) => ROWS.map((n) => tableFor(n, r).max)));

/** One drop: `rows` fair bounces (true = right). The bucket is the count of rights. */
export function dropBall(next: () => number, rows: number): { path: boolean[]; bucket: number } {
  const path: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < rows; i++) {
    const right = next() < 0.5;
    path.push(right);
    if (right) bucket++;
  }
  return { path, bucket };
}

/** Bucket label as printed on the board: at most 2 decimals, no trailing zeros. */
export function bucketLabel(m: number): string {
  if (m >= 100) return String(Math.round(m));
  return String(Math.round(m * 100) / 100);
}

/** The exact value for paytables: up to 4 decimals for the solved plateau. */
export function exactLabel(m: number): string {
  if (m >= 1000) return Math.round(m).toLocaleString('en-US');
  if (m >= 100) return bucketLabel(m);
  const r = Math.round(m * 10000) / 10000;
  return String(r);
}

/** Lobby-style volatility label for a table. */
export function volatilityOf(rows: number, risk: Risk): 'low' | 'medium' | 'high' | 'extreme' {
  const sd = tableFor(rows, risk).stdDev;
  return sd < 0.8 ? 'low' : sd < 2 ? 'medium' : sd < 4.5 ? 'high' : 'extreme';
}

/**
 * Resolves one ball completely at the moment it is dropped: exactly `rows`
 * draws from the RNG, the bucket, and the multiplier it pays. The animation
 * only replays this path, so leaving mid-flight settles at the drawn result.
 */
export function resolveDrop(next: () => number, rows: number, risk: Risk) {
  const { path, bucket } = dropBall(next, rows);
  return { path, bucket, multiplier: tableFor(rows, risk).mults[bucket] };
}
