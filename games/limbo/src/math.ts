// Limbo (Stake, BC.Game, Shuffle, Rainbet…): pick a target multiplier t, then a
// result X is drawn from the "fair crash" law P(X ≥ x) = 0.99 / x. You win t
// when X ≥ t, so every target is worth exactly t · 0.99 / t = 0.99: the target
// only sets the volatility, never the return.
//
// The draw. U is uniform on (0, 1] and X = floor(99 / U) / 100, i.e. 0.99 / U
// truncated to whole cents (and capped at 1,000,000×; shown as at least
// 1.00×). For a target with whole cents T = 100·t (101 ≤ T ≤ 10^8):
//
//     X ≥ t  ⇔  floor(99 / U) ≥ T  ⇔  99 / U ≥ T  ⇔  U ≤ 99 / T = 0.99 / t,
//
// because T is an integer. So P(win) = 0.99 / t and RTP = 99% exactly. The cap
// and the 1.00× display floor sit outside every target's decision boundary
// (targets run 1.01×–1,000,000×), so they never change a result.
//
// Exact on the lattice. In code U = k / N with k uniform on {1, …, N} and
// N = 2^52 (two RNG draws: 32 + 20 bits), and the floor is done in integer
// (BigInt) arithmetic: X_cents = floor(99·N / k). Then
//
//     win  ⇔  floor(99N / k) ≥ T  ⇔  k ≤ floor(99·N / T),   P(win) = floor(99·N / T) / N,
//
// so the lattice RTP is (T/100) · floor(99N/T) / N ∈ (0.99 − T/(100N), 0.99],
// i.e. 99% to within 2.3e-10 for every target (T/(100N) ≤ 10^6 / 2^52), and
// never above it. Tests check this formula against the implementation at the
// exact boundary k for every preset and a sweep of targets.
//
// Max payout: the largest target, 1,000,000×.

export const RTP = 0.99;

export const MIN_TARGET = 1.01;
export const MAX_TARGET = 1_000_000;
export const MAX_MULTIPLIER = MAX_TARGET;

/** Lattice size for U: 2^52. */
export const LATTICE_BITS = 52;
export const N = 2 ** LATTICE_BITS;
const NB = BigInt(N);
const A = 99n * NB;
const MAX_CENTS = MAX_TARGET * 100;

/** Win chance range (percent) that the target range implies. */
export const MAX_CHANCE = (RTP * 100) / MIN_TARGET; // 98.0198…%
export const MIN_CHANCE = (RTP * 100) / MAX_TARGET; // 0.000099%

/** Quick-pick targets shown as chips. */
export const PRESETS = [1.5, 2, 3, 5, 10, 100, 1000] as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Clamps and rounds a typed target to whole cents in [1.01, 1,000,000]. */
export const clampTarget = (t: number) => Math.min(MAX_TARGET, Math.max(MIN_TARGET, round2(t)));

/** Target in whole cents (the integer T in the header). */
export const targetCents = (t: number) => Math.round(clampTarget(t) * 100);

/** Nominal win chance as a probability: 0.99 / t. */
export const winChance = (t: number) => RTP / t;

/** Target for a typed win chance in percent (rounded to cents, clamped). */
export const targetForChance = (pct: number) => clampTarget((RTP * 100) / pct);

/** Exact lattice win probability floor(99N/T)/N. */
export function exactChance(t: number): number {
  const T = BigInt(targetCents(t));
  return Number(A / T) / N;
}

/** Exact lattice RTP for a target: (T/100) · floor(99N/T) / N. */
export const exactRtp = (t: number) => (targetCents(t) / 100) * exactChance(t);

/** The integer k ∈ {1, …, N} from two RNG draws (32 + 20 bits). U = k / N. */
export function drawK(next: () => number): number {
  const hi = Math.floor(next() * 2 ** 32);
  const lo = Math.floor(next() * 2 ** 20);
  return hi * 2 ** 20 + lo + 1;
}

/** Result in whole cents for lattice point k ∈ [1, N]: min(10^8, floor(99N/k)). */
export function resultCentsFor(k: number): number {
  const c = A / BigInt(k);
  return c >= BigInt(MAX_CENTS) ? MAX_CENTS : Number(c);
}

export interface Outcome {
  /** The displayed result multiplier (≥ 1.00, 2 decimals). */
  result: number;
  win: boolean;
  /** Payout multiplier: the target on a win, else 0. */
  multiplier: number;
}

/** Decides one bet at a target from a lattice point k. */
export function decide(k: number, target: number): Outcome {
  const T = targetCents(target);
  const cents = resultCentsFor(k);
  const win = cents >= T;
  return { result: Math.max(100, cents) / 100, win, multiplier: win ? T / 100 : 0 };
}

/** One bet at a target. */
export const play = (next: () => number, target: number) => decide(drawK(next), target);

/** Volatility label for a target (used by the badge and the eval bands). */
export function volatilityOf(t: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (t < 1.75) return 'low';
  if (t < 5) return 'medium';
  if (t < 50) return 'high';
  return 'extreme';
}

/**
 * Position of a multiplier on the odds track: 1 − 0.99/x. The share of the
 * track to the right of the target is then exactly the win chance 0.99/t, and
 * the result marker lands uniformly along it (it sits at ≈ 1 − U).
 */
export const trackPos = (x: number) => Math.min(1, Math.max(0, 1 - RTP / Math.max(x, RTP)));

/** Formats a percentage with enough digits for tiny chances. */
export function fmtPct(pct: number): string {
  if (pct >= 1) return pct.toFixed(4);
  if (pct >= 0.0001) return pct.toFixed(6);
  return pct.toPrecision(4);
}

/** Formats a target or result multiplier with thousands separators and 2 decimals. */
export const fmtX = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
