// Polarizer: a photon polarised at 0° must reach 90°. Each polarizer is set
// Δ degrees further round than the photon's current polarisation, and the
// photon passes it with probability cos²Δ (Malus's law: the squared length of
// the polarisation vector projected onto the new axis). If it passes, it is
// re-polarised along the new axis; if not, it is absorbed and the round is lost.
//
// One polarizer at 90° stops every photon (cos²90° = 0), but n polarizers at
// 90°/n each let it through with probability cos^(2n)(90°/n), which tends to 1
// as n grows: the quantum Zeno effect. Many small turns are safe and pay
// little; a few big turns are risky and pay a lot.
//
// Pricing (per-step fair factor): passing a polarizer turned by Δ multiplies
// the cash-out by 1/cos²Δ. With bust chance q = 1 − cos²Δ that is a fair bet,
// E[cash after] = cos²Δ · cash / cos²Δ = cash, so the cash-out is a martingale
// starting at RTP and every stopping rule, and every choice of Δ, is worth
// exactly RTP. The choice of Δ moves only the variance.
//
// Turns are multiples of 5° between 5° and 85°, and never past 90°, so a
// q = 1 step (a 90° turn) is never offered. Because ln(1/cos²x) is convex, the
// largest possible payout is the most lopsided path, 85° then 5°: about 131×.
// Every payout is bounded by that, so no max-win cap is needed.
//
// Tie rule: a uniform u in [0, 1) is drawn; the photon passes iff u < cos²Δ.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The target polarisation, in degrees. */
export const GOAL = 90;
/** Every turn is a multiple of this many degrees. */
export const GRID = 5;
/** The largest turn on offer (90° would stop every photon). */
export const MAX_TURN = 85;

/** Turn sizes on offer. Each one is also a Zeno preset: equal turns all the way to 90°. */
export const TURNS = [5, 10, 15, 30, 45, 60, 75, 85] as const;
export type Turn = (typeof TURNS)[number];

export const VOLATILITY: Record<Volatility, { turn: Turn }> = {
  low: { turn: 5 },
  medium: { turn: 30 },
  high: { turn: 60 },
  extreme: { turn: 85 },
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Malus's law: the chance a photon passes a polarizer turned by delta degrees. */
export const passChance = (delta: number) => Math.cos(rad(delta)) ** 2;

/** Whether a turn of delta degrees may be fired from polarisation angle. */
export function allowedTurn(angle: number, delta: number): boolean {
  return Number.isInteger(delta / GRID) && delta >= GRID && delta <= Math.min(MAX_TURN, GOAL - angle);
}

/** The turn actually fired from angle when the chosen turn size is turn: never past 90°. */
export const nextTurn = (angle: number, turn: number) => Math.min(turn, GOAL - angle);

/** The remaining polarizers for a plan of equal turns (the last one takes whatever is left). */
export function plan(angle: number, turn: number): number[] {
  const out: number[] = [];
  for (let a = angle; a < GOAL; ) {
    const d = nextTurn(a, turn);
    out.push(d);
    a += d;
  }
  return out;
}

/** Exact chance of reaching 90° from angle with equal turns of the given size. */
export const planChance = (angle: number, turn: number) => plan(angle, turn).reduce((p, d) => p * passChance(d), 1);

/** Quantum Zeno: n equal turns of 90°/n pass with chance cos^(2n)(90°/n). */
export const zeno = (n: number) => Math.cos(rad(GOAL / n)) ** (2 * n);

/** Cash-out after passing a polarizer turned by delta. */
export const afterPass = (cash: number, delta: number) => cash / passChance(delta);

/** What reaching 90° pays if you follow the plan from here: cash-out ÷ chance. */
export const prizeFor = (cash: number, angle: number, turn: number) => cash / planChance(angle, turn);

/** One firing: the photon passes iff the uniform draw u is below cos²Δ. */
export const passes = (u: number, delta: number) => u < passChance(delta);

/**
 * The drawn projection. The polarisation vector (length 1 at angle θ) is
 * projected onto the new axis θ + Δ. Its shadow has length cos Δ, the foot of
 * the perpendicular sits that far along the new axis, and the squared shadow
 * is the pass chance shown as the bar.
 */
export function projection(angle: number, delta: number) {
  const shadow = Math.cos(rad(delta));
  const axis = rad(angle + delta);
  return {
    shadow,
    tip: { x: Math.cos(rad(angle)), y: Math.sin(rad(angle)) },
    foot: { x: shadow * Math.cos(axis), y: shadow * Math.sin(axis) },
    bar: shadow * shadow,
  };
}

export function volatilityOf(turn: number): Volatility {
  const p = planChance(0, turn);
  return p > 0.6 ? 'low' : p > 0.2 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

/**
 * The largest product of fair factors on any path from angle to 90°, by
 * dynamic programming over the 5° grid. From 0° this is 1/(cos²85° · cos²5°).
 */
export function maxFactor(angle = 0): number {
  const best: number[] = [1];
  const steps = (GOAL - angle) / GRID;
  for (let r = 1; r <= steps; r++) {
    let m = 0;
    for (let k = 1; k <= Math.min(r, MAX_TURN / GRID); k++) m = Math.max(m, best[r - k] / passChance(k * GRID));
    best.push(m);
  }
  return best[steps];
}

/** An honest bound on every payout, rounded up to the cent. */
export const MAX_MULTIPLIER = Math.ceil(RTP * maxFactor(0) * 100) / 100;
