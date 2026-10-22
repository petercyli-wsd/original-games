// Roots: a random quadratic y = ax² + bx + c, with a and c uniform on (−1, 1)
// and b uniform on (−B, B). The player backs "real roots" (the curve meets the
// line y = 0) or "no real roots" (it misses). The coefficients are revealed
// one at a time: a, then c, then b.
//
// The theorem. The curve has real roots exactly when the discriminant
// b² − 4ac ≥ 0. For a, b, c all uniform on (−1, 1) that happens with
// probability (41 + 6 ln 2)/72 ≈ 62.7%. Tie rule: a repeated root (b² = 4ac,
// the curve just touches the line) counts as real; it has probability zero.
//
// Exact win chances at every stage (t = ac, α = |a|):
//
//   after a and c:  P(real) = 1                       if ac ≤ 0
//                           = max(0, 1 − 2√(ac)/B)   otherwise.
//     b is uniform, and it misses only inside the band |b| < 2√(ac): one
//     interval on the b-ruler, whose length is drawn.
//
//   after a only:   c is uniform, so t = ac is uniform on [−α, α].
//                   P(real) = 1 − 2√α/(3B)           if α ≤ B²/4
//                           = ½ + B²/(24α)           otherwise.
//
//   before a:       ac < 0 half the time; given ac > 0, t = |a||c| has density
//                   −ln t on (0, 1). So with T = min(1, B²/4)
//                   P(real) = ½ + ½∫₀ᵀ (1 − 2√t/B)(−ln t) dt
//                           = ½ + ½[T − T ln T − (2/B)(4/9 − 2/3·ln T)T^{3/2}].
//                   B = 1 gives (41 + 6 ln 2)/72; for B ≥ 2 it is
//                   1 − 4/(9B), so "no real roots" is 4/(9B).
//
// The odds map. Put the pair (b, ac) in a plane, b across and ac up. The
// curve b² = 4ac is a fixed cup, and the quadratic has no real roots exactly
// inside it. Whatever is still unknown fills a box uniformly: after a it is
// [−B, B] × [−α, α] (b and c uniform), after c a single horizontal segment
// (the b-ruler), after b a point. Before a, the vertical axis is stretched by
// the distribution function of ac, so equal heights are equally likely there
// too. At every stage the green share of the box IS the win chance.
//
// Pricing (fixed prize). A full win pays prize = RTP / P(side). The cash-out
// in any state S is prize × P(side | S). Each reveal averages P(side | S)
// back to its current value (the tower property of conditional expectation),
// so the cash-out is a martingale that starts at RTP, and by optional stopping
// every cash-out strategy returns exactly RTP. A reveal that settles the
// question (ac ≤ 0, or 2√(ac) ≥ B) ends the round at once. The largest payout
// is the full prize of the longest shot: no real roots with B = 32,
// RTP × 72 = 71.28×. Cash-outs never exceed the prize.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The range of b, ±B. Wider ranges make real roots likelier. */
export const RANGES = [0.5, 1, 2, 4, 8, 16, 32] as const;
export type Range = (typeof RANGES)[number];

export type Side = 'real' | 'none';
export const SIDES: readonly Side[] = ['real', 'none'];
export const SIDE_LABEL: Record<Side, string> = { real: 'Real roots', none: 'No real roots' };
export const other = (side: Side): Side => (side === 'real' ? 'none' : 'real');

export const VOLATILITY: Record<Volatility, { side: Side; range: Range }> = {
  low: { side: 'real', range: 2 },
  medium: { side: 'none', range: 1 },
  high: { side: 'none', range: 4 },
  extreme: { side: 'none', range: 32 },
};

/** The coefficients revealed so far (in the order a, c, b). */
export interface Coeffs {
  a: number | null;
  c: number | null;
  b: number | null;
}

export const HIDDEN: Coeffs = { a: null, c: null, b: null };

/** 0 = nothing shown, 1 = a, 2 = a and c, 3 = all three. */
export type Stage = 0 | 1 | 2 | 3;

export const stageOf = (k: Coeffs): Stage => (k.a === null ? 0 : k.c === null ? 1 : k.b === null ? 2 : 3);

/** Draws a coefficient uniformly on (−range, range) from a uniform u in [0, 1). */
export const draw = (u: number, range: number) => range * (2 * u - 1);

/** The discriminant test. Tie rule: a repeated root counts as real. */
export const isReal = (a: number, b: number, c: number) => b * b >= 4 * a * c;

/** Half-width of the miss band on the b-ruler: no real roots exactly when |b| < 2√(ac). */
export const missHalfWidth = (a: number, c: number) => (a * c > 0 ? 2 * Math.sqrt(a * c) : 0);

/** P(real roots) before anything is revealed. */
export function pReal0(B: number): number {
  const T = Math.min(1, (B * B) / 4);
  const lnT = Math.log(T);
  const T32 = T ** 1.5;
  return 0.5 + 0.5 * (T - T * lnT - (2 / B) * ((4 / 9) * T32 - (2 / 3) * T32 * lnT));
}

/** P(real roots | a). */
export function pReal1(a: number, B: number): number {
  const alpha = Math.abs(a);
  if (alpha <= (B * B) / 4) return 1 - (2 * Math.sqrt(alpha)) / (3 * B);
  return 0.5 + (B * B) / (24 * alpha);
}

/** P(real roots | a, c): the real share of the b-ruler. */
export const pReal2 = (a: number, c: number, B: number) => Math.max(0, 1 - missHalfWidth(a, c) / B);

export function pReal(k: Coeffs, B: number): number {
  if (k.a === null) return pReal0(B);
  if (k.c === null) return pReal1(k.a, B);
  if (k.b === null) return pReal2(k.a, k.c, B);
  return isReal(k.a, k.b, k.c) ? 1 : 0;
}

/** P(the backed side wins | what is revealed). */
export const pWin = (side: Side, k: Coeffs, B: number) => (side === 'real' ? pReal(k, B) : 1 - pReal(k, B));

/** The full prize: what a win pays. */
export const prize = (side: Side, B: number) => RTP / pWin(side, HIDDEN, B);

/** The fair cash-out: prize × the current chance. A martingale starting at RTP. */
export const cashOut = (side: Side, k: Coeffs, B: number) => prize(side, B) * pWin(side, k, B);

/** Whether the revealed coefficients already settle the bet. */
export function decided(k: Coeffs, B: number): boolean {
  const p = pReal(k, B);
  return p === 0 || p === 1;
}

export function volatilityOf(side: Side, B: number): Volatility {
  const p = pWin(side, HIDDEN, B);
  return p >= 0.5 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** Any payout is at most the full prize, which peaks at no real roots with the widest b range. */
export const MAX_MULTIPLIER = Math.max(...RANGES.flatMap((B) => [prize('real', B), prize('none', B)]));

// ---------- The odds map ----------

/** Distribution function of ac for a, c uniform on (−1, 1): P(ac ≤ p). */
export function acCdf(p: number): number {
  if (p <= -1) return 0;
  if (p >= 1) return 1;
  const s = Math.abs(p);
  const g = s === 0 ? 0 : s - s * Math.log(s); // P(uv ≤ s) for u, v uniform on (0, 1)
  return p < 0 ? 0.5 * (1 - g) : 0.5 + 0.5 * g;
}

/**
 * Height (0 bottom to 1 top) of ac = p on the odds map. zoom 0 is the
 * before-a box, stretched by acCdf over [−1, 1] so equal heights are equally
 * likely; zoom 1 is the after-a box, linear over [−α, α]. In between it blends.
 */
export function mapV(p: number, zoom: number, alpha: number): number {
  const v0 = acCdf(p);
  if (zoom <= 0) return v0;
  const al = Math.max(alpha, 1e-12);
  const v1 = (p + al) / (2 * al);
  return v0 + (v1 - v0) * zoom;
}

/** The ac at the top edge of the box (where mapV reaches 1). */
function topOfBox(zoom: number, alpha: number): number {
  if (zoom <= 0) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    if (mapV(mid, zoom, alpha) < 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The "no real roots" region of the odds map clipped to the box, as a polygon
 * in map units: u = b/B from −1 (left) to 1 (right), v from 0 (bottom) to 1
 * (top). Its share of the box (area / 2) is the chance of no real roots.
 */
export function noRealOutline(B: number, zoom: number, alpha: number, n = 96): [number, number][] {
  const pTop = topOfBox(zoom, alpha);
  const uEnd = Math.min(1, (2 * Math.sqrt(pTop)) / B);
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = -uEnd + (2 * uEnd * i) / n;
    const b = u * B;
    pts.push([u, Math.min(1, mapV((b * b) / 4, zoom, alpha))]);
  }
  pts.push([uEnd, 1], [-uEnd, 1]);
  return pts;
}

/** Shoelace area of a polygon. */
export function polygonArea(pts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** The miss band on the b-ruler after c, in map units (u = b/B): no real roots for |u| < h. */
export const rulerBand = (a: number, c: number, B: number) => Math.min(1, missHalfWidth(a, c) / B);

// ---------- The curve ----------

/** Roots of ax² + bx + c (empty if none are real). */
export function roots(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? [] : [-c / b];
  const d = b * b - 4 * a * c;
  if (d < 0) return [];
  const s = Math.sqrt(d);
  // Numerically stable pair.
  const q = -0.5 * (b + (b >= 0 ? s : -s));
  if (q === 0) return [0];
  return [q / a, c / q].sort((x, y) => x - y);
}

/** The turning point of ax² + bx + c. */
export const vertex = (a: number, b: number, c: number) => ({ x: -b / (2 * a), y: c - (b * b) / (4 * a) });
