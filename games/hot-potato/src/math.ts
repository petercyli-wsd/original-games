// Hot Potato: 10 seats sit on a ring and a bomb starts on the top seat (seat
// 0). You back k seats facing it across the ring (k = 1, 3, 5, 7 or 9, centred
// on seat 5). Each spin of the fuse dial is one uniform draw u, read off three
// slices: u < h (h = 1/5) the bomb blows on the seat it sits on; otherwise it
// hops to the clockwise or anticlockwise neighbour, (1 − h)/2 each. You win if
// it blows on one of your seats.
//
// The theorem: a killed random walk. Let P be the hop matrix of the walk on the
// cycle. The bomb, sitting on x, blows on s after exactly k hops with chance
// (1 − h)^k·h·(P^k)ₓₛ, so
//     G = Σₖ₌₀ h(1 − h)^k P^k = h·(I − (1 − h)P)⁻¹,
// the resolvent of the walk scaled by the kill rate. The ring is symmetric, so
// G depends only on the offset d = s − x (mod n): one vector g[d] = h·u[d] with
// (I − (1 − h)P)u = e₀. Away from d = 0 the equation is homogeneous, so
// u[d] = A·(rᵈ + rⁿ⁻ᵈ) with r the root in (0, 1) of ((1 − h)/2)(r + 1/r) = 1:
//     r = (1 − √(1 − (1 − h)²)) / (1 − h),
// and the d = 0 row fixes A = 1 / ((1 + rⁿ) − (1 − h)(r + rⁿ⁻¹)). With h = 1/5
// the root is exactly r = 1/2: each seat further from the bomb is half as
// likely to be where it blows (plus the wrap-round term rⁿ⁻ᵈ). No simulation.
//
// The heat ring draws g rotated to the bomb's seat: every seat's chance to be
// where it blows, summing to 1, sweeping round as the bomb moves. Your seats'
// share of it is your chance W(x).
//
// Pricing (fixed prize): prize = RTP / W(0) and cash-out = prize · W(x).
// W(x) = h·[x is yours] + ((1 − h)/2)(W(x − 1) + W(x + 1)): the three slices
// of the next spin average back to the odds now, so W is a martingale (the
// conditional probability of one fixed event). The cash-out starts at RTP
// (the first checkpoint comes before any spin) and every stopping rule
// returns exactly RTP by optional stopping (rounds end almost surely, after
// 1/h = 5 spins on average). The only payout above the stake is the prize,
// at most RTP / g[5] for a single seat, so maxMultiplier = ⌈that⌉ is honest.
//
// Tie rule: the spin blows iff u < h, else hops clockwise iff u < h + (1 − h)/2,
// with u = rng.next() on the 2^32 grid: exact to within 2^−32.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Seats on the ring. */
export const N = 10;
/** The fuse: the chance each spin blows (the red slice). */
export const H = 0.2;

/** The one knob: how many seats you back, centred opposite the start. */
export const SEAT_OPTIONS = [1, 3, 5, 7, 9] as const;
export type SeatsBacked = (typeof SEAT_OPTIONS)[number];

export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** r: the per-seat decay of the heat, the root in (0, 1) of ((1 − h)/2)(r + 1/r) = 1. */
export function decay(h = H): number {
  const k = 1 - h;
  return (1 - Math.sqrt(1 - k * k)) / k;
}

const cache = new Map<string, Float64Array>();

/** g[d]: the chance the bomb, now on some seat, finally blows d seats clockwise of it. */
export function blowFromHere(n = N, h = H): Float64Array {
  const key = `${n}:${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = decay(h);
  const A = 1 / (1 + r ** n - (1 - h) * (r + r ** (n - 1)));
  const g = new Float64Array(n);
  for (let d = 0; d < n; d++) g[d] = h * A * (r ** d + r ** (n - d));
  cache.set(key, g);
  return g;
}

/** Every seat's chance to be where the bomb blows, with the bomb on `seat`. Sums to 1. */
export function heat(seat: number): number[] {
  const g = blowFromHere();
  return Array.from({ length: N }, (_, s) => g[mod(s - seat, N)]);
}

/** The k backed seats: a block centred on the seat opposite the start. */
export function backedSeats(k: number): number[] {
  const half = N / 2;
  const lo = half - (k - 1) / 2;
  return Array.from({ length: k }, (_, i) => lo + i);
}

/** Your chance to win: the chance it blows on one of `picks`, with the bomb on `seat`. */
export function winChance(seat: number, picks: readonly number[]): number {
  const g = blowFromHere();
  let p = 0;
  for (const s of picks) p += g[mod(s - seat, N)];
  return p;
}

/** Whether a blast on `seat` wins the bet. */
export const winsAt = (seat: number, picks: readonly number[]) => picks.includes(mod(seat, N));

/** The fixed prize for a fresh bet (bomb on the top seat). */
export const startPrize = (picks: readonly number[]) => RTP / winChance(0, picks);

/** The largest prize over every setting (one seat, opposite the start). */
export function maxStartPrize(): number {
  return Math.max(...SEAT_OPTIONS.map((k) => startPrize(backedSeats(k))));
}

/** An honest bound on any payout. */
export const MAX_MULTIPLIER = Math.ceil(maxStartPrize());

export interface SpinOutcome {
  /** 0: blows where it sits; ±1: hops to that neighbour. */
  move: -1 | 0 | 1;
  /** Chance of this slice. */
  prob: number;
  /** Your chance to win after it: 1 or 0 if it blows. */
  win: number;
}

/** The three slices of the next spin. Σ prob·win = winChance now. */
export function nextSpin(seat: number, picks: readonly number[]): SpinOutcome[] {
  const pass = (1 - H) / 2;
  return [
    { move: 0, prob: H, win: winsAt(seat, picks) ? 1 : 0 },
    { move: 1, prob: pass, win: winChance(mod(seat + 1, N), picks) },
    { move: -1, prob: pass, win: winChance(mod(seat - 1, N), picks) },
  ];
}

/**
 * One spin of the fuse dial: a single uniform u. The dial's slices, clockwise
 * from the bomb's side: [0, h) blows, [h, h + (1 − h)/2) hops clockwise, the
 * rest hops anticlockwise. `u` is kept so the needle lands where it was drawn.
 */
export function spin(next: () => number): { u: number; blows: boolean; dir: -1 | 1 } {
  const u = next();
  const blows = u < H;
  const dir = u < H + (1 - H) / 2 ? 1 : -1;
  return { u, blows, dir };
}

/** Where u lands on the dial, in degrees clockwise from the bomb's side (red slice centred on 0). */
export const needleAngle = (u: number) => -H * 180 + u * 360;

export function volatilityOf(p: number): Volatility {
  return p > 0.4 ? 'low' : p > 0.12 ? 'medium' : p > 0.025 ? 'high' : 'extreme';
}
