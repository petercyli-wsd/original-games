// Crash Colours (the "trend ball" format of BC.Game and others), rebuilt.
//
// The process. A crash point C is drawn exactly as in Crash and Limbo:
//   U uniform on (0, 1],  C = floor(99 / U) / 100   (clamped to [1.00, 1,000,000]),
// so for every target t on the 0.01 grid with 1.01 ≤ t ≤ 1,000,000
//   P(C ≥ t) = P(U ≤ 0.99 / t) = 0.99 / t        (the crash survival law).
// C = 1.00 happens with probability 1 − 0.99/1.01 ≈ 1.98% (an instant crash).
//
// The bets. There is no cash-out: the player stakes any of three colour bands,
// split by two lines, the green line L and the moon line M (L < M):
//   Red    C < L    P = 1 − 0.99/L   pays 0.99 / (1 − 0.99/L)   (L = 2: 0.505, 1.960396…×)
//   Green  C ≥ L    P = 0.99/L       pays L                       (L = 2: 0.495, 2×)
//   Moon   C ≥ M    P = 0.99/M       pays M                       (M = 10: 0.099, 10×)
// Each band's expected return is P × pay = 0.99 exactly, in closed form. A bet
// is any mix of the three; by linearity of expectation every mix returns
// exactly RTP = 99%, and the lines L and M only move the volatility. The
// classic table is L = 2, M = 10; we also offer L ∈ {1.5, 2, 3} and
// M ∈ {5, 10, 20, 50, 100, 1000}, every one priced by the same law.
//
// The largest payout multiplier on a ticket is max(M) = 1000 (a Moon-only bet
// at the 1000× line); Red at L = 1.5 pays 2.9118×.
//
// The animation is cosmetic: the multiplier climbs along the fixed time curve
// m(t) = (1 − t/T)^(−K) until it reaches C, so the bands light up as their
// lines are passed. The outcome is decided before the climb starts.

export const RTP = 0.99;
export const MAX_CRASH = 1_000_000;

export type Band = 'red' | 'green' | 'moon';
export const BANDS: Band[] = ['red', 'green', 'moon'];

export const SPLITS = [1.5, 2, 3] as const;
export const MOONS = [5, 10, 20, 50, 100, 1000] as const;
export const DEFAULT_SPLIT = 2;
export const DEFAULT_MOON = 10;

export const MAX_MULTIPLIER = Math.max(...MOONS, ...SPLITS.map((l) => RTP / (1 - RTP / l)));

/** Lines are on the 0.01 grid; compare in integer cents so ties are exact (C = L counts as Green). */
const cents = (x: number) => Math.round(x * 100);

/** P(C ≥ x) for x on the 0.01 grid: 1 for x ≤ 1, 0.99/x up to the cap, 0 beyond. */
export function survival(x: number): number {
  if (cents(x) <= 100) return 1;
  if (cents(x) > MAX_CRASH * 100) return 0;
  return RTP / x;
}

/** The crash point from U in (0, 1]: floor(99/U)/100, clamped to [1, MAX_CRASH]. */
export function crashFromU(U: number): number {
  const c = Math.floor(99 / U);
  return Math.min(MAX_CRASH * 100, Math.max(100, c)) / 100;
}

/** The crash point from a host rng draw u in [0, 1) (U = 1 − u lies in (0, 1]). */
export const crashPoint = (u: number) => crashFromU(1 - u);

export interface Lines {
  split: number;
  moon: number;
}

/** Win chance of each band. */
export function chances({ split, moon }: Lines): Record<Band, number> {
  return { red: 1 - survival(split), green: survival(split), moon: survival(moon) };
}

/** Payout multiplier of each band: RTP / chance, which is exactly L and M for Green and Moon. */
export function payouts(lines: Lines): Record<Band, number> {
  const p = chances(lines);
  return { red: RTP / p.red, green: lines.split, moon: lines.moon };
}

/** Which bands a crash point wins. */
export function winners(crash: number, { split, moon }: Lines): Record<Band, boolean> {
  const c = cents(crash);
  return { red: c < cents(split), green: c >= cents(split), moon: c >= cents(moon) };
}

/** The colour of a crash point for the history row: moon beats green beats red. */
export function bandOf(crash: number, lines: Lines): Band {
  const w = winners(crash, lines);
  return w.moon ? 'moon' : w.green ? 'green' : 'red';
}

export type Stakes = Record<Band, number>;

export const totalOf = (s: Stakes) => s.red + s.green + s.moon;

/** The amount returned by a ticket (stake × pay on every winning band). */
export function payoutOf(stakes: Stakes, crash: number, lines: Lines): number {
  const w = winners(crash, lines);
  const pay = payouts(lines);
  return BANDS.reduce((sum, b) => sum + (w[b] ? stakes[b] * pay[b] : 0), 0);
}

/** The ticket's payout multiplier (amount returned ÷ total stake). */
export function multiplierOf(stakes: Stakes, crash: number, lines: Lines): number {
  const total = totalOf(stakes);
  return total > 0 ? payoutOf(stakes, crash, lines) / total : 0;
}

/** Scales a stake mix to a new total, keeping its proportions (auto-bet's on win / on loss). */
export function scaleStakes(stakes: Stakes, total: number): Stakes {
  const t = totalOf(stakes);
  if (!(t > 0)) return { red: 0, green: 0, moon: 0 };
  const f = total / t;
  return { red: stakes.red * f, green: stakes.green * f, moon: stakes.moon * f };
}

/**
 * The exact outcome distribution of a ticket's multiplier: the crash line
 * splits into three regions, [1, L), [L, M) and [M, ∞), each with a fixed
 * payout. Used for the exact RTP, the volatility badge and the tests.
 */
export function distribution(stakes: Stakes, lines: Lines): { p: number; mult: number }[] {
  const total = totalOf(stakes);
  if (!(total > 0)) return [];
  const pay = payouts(lines);
  const pRed = 1 - survival(lines.split);
  const pMoon = survival(lines.moon);
  const pGreen = survival(lines.split) - pMoon;
  return [
    { p: pRed, mult: (stakes.red * pay.red) / total },
    { p: pGreen, mult: (stakes.green * pay.green) / total },
    { p: pMoon, mult: (stakes.green * pay.green + stakes.moon * pay.moon) / total },
  ];
}

export function expectedReturn(stakes: Stakes, lines: Lines): number {
  return distribution(stakes, lines).reduce((s, o) => s + o.p * o.mult, 0);
}

export function stdDev(stakes: Stakes, lines: Lines): number {
  const d = distribution(stakes, lines);
  const m = d.reduce((s, o) => s + o.p * o.mult, 0);
  const m2 = d.reduce((s, o) => s + o.p * o.mult * o.mult, 0);
  return Math.sqrt(Math.max(0, m2 - m * m));
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';

export function volatilityOf(stakes: Stakes, lines: Lines): Volatility {
  const sd = stdDev(stakes, lines);
  return sd < 0.5 ? 'low' : sd < 2 ? 'medium' : sd < 6 ? 'high' : 'extreme';
}

/** Chance that the ticket returns anything at all. */
export function anyWinChance(stakes: Stakes, lines: Lines): number {
  return distribution(stakes, lines).reduce((s, o) => s + (o.mult > 0 ? o.p : 0), 0);
}

// ---------- the cosmetic climb ----------

/** Curve steepness: m(t) = (1 − t/T)^(−K). */
export const CURVE_K = 2.2;

/** The multiplier shown t ms into a climb whose time scale is T. */
export const multAt = (t: number, T: number) => Math.pow(Math.max(1e-9, 1 - t / T), -CURVE_K);

/** How long the climb takes to reach m (inverse of multAt). Always < T. */
export const timeAt = (m: number, T: number) => T * (1 - Math.pow(Math.max(1, m), -1 / CURVE_K));
