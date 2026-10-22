// Landing: a token starts on square 0 and moves forward by a fair d-sided die
// (each of 1..d with chance 1/d). The player marks 1–4 gate squares before the
// bet. The round is won when the token has landed exactly on every gate;
// jumping over a gate loses at once.
//
// Renewal theorem. Let u(n) be the chance that the token, standing on some
// square, ever lands exactly n squares further on. Its next roll lands on one
// of the d squares ahead, each with chance 1/d, and the walk then starts afresh:
//
//     u(0) = 1,   u(n < 0) = 0,   u(n) = (1/d) · Σ_{j=1..d} u(n − j).
//
// For 1 ≤ n ≤ d this is (1/d)(1 + 1/d)^(n−1), which peaks at n = d. After that
// it wobbles and settles on 1 / (mean step) = 2/(d + 1): the renewal theorem
// (Erdős–Feller–Pollard). A far gate is hit 40% of the time with a d4, 28.6%
// with a d6 and 18.2% with a d10.
//
// Gates are renewal points: once the token stands on a gate its future does not
// depend on how it got there. So with the token on square x and gate i next,
//
//     P(win | x, i) = u(g_i − x) · Π_{j > i} u(g_j − g_{j−1}).
//
// Pricing (fixed prize). Prize = RTP / P(win from square 0), and the cash-out
// in any state S is prize · P(win | S). The recursion for u says exactly that
// P(win | S) is the average of P(win | S′) over the d faces of the next roll
// (landing past the gate gives 0, landing on the last gate gives 1), so the
// cash-out is a martingale starting at RTP. By optional stopping every cash-out
// rule returns exactly RTP. Gate placement is chosen before the bet and moves
// P(win) (the volatility), never the 99% value.
//
// Max win: u(n) ≥ 1/d for all n ≥ 1 (true for n ≤ d, and beyond that u(n) is an
// average of terms ≥ 1/d), so the prize is at most RTP · d^k ≤ RTP · 10⁴, and
// no cash-out ever exceeds the prize. All positions are integers: there are no
// floating boundaries to break ties on.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The track: squares 0 (start) to 59, drawn as a 10-wide serpentine. */
export const SQUARES = 60;
export const LAST_SQUARE = SQUARES - 1;
export const COLS = 10;

export const DICE = [4, 6, 10] as const;
export type Die = (typeof DICE)[number];

export const GATE_COUNTS = [1, 2, 3, 4] as const;
export type GateCount = (typeof GATE_COUNTS)[number];

/** Where the gates go when the player picks a count (they can then move them). */
export const PRESETS: Record<GateCount, readonly number[]> = {
  1: [20],
  2: [15, 30],
  3: [12, 24, 36],
  4: [12, 24, 36, 48],
};

export const VOLATILITY: Record<Volatility, { die: Die; gates: readonly number[] }> = {
  low: { die: 4, gates: PRESETS[1] },
  medium: { die: 6, gates: PRESETS[2] },
  high: { die: 6, gates: PRESETS[3] },
  extreme: { die: 10, gates: PRESETS[4] },
};

/** The renewal limit 1 / (mean step). */
export const renewalLimit = (d: Die) => 2 / (d + 1);

const tables = new Map<Die, Float64Array>();

/** u(0..SQUARES + d): the chance of ever landing exactly n squares ahead. */
export function hitTable(d: Die): Float64Array {
  let u = tables.get(d);
  if (!u) {
    u = new Float64Array(SQUARES + d + 1);
    u[0] = 1;
    for (let n = 1; n < u.length; n++) {
      let s = 0;
      for (let j = 1; j <= d && j <= n; j++) s += u[n - j];
      u[n] = s / d;
    }
    tables.set(d, u);
  }
  return u;
}

/** u(n), with u(n < 0) = 0. */
export function hitChance(n: number, d: Die): number {
  if (n < 0) return 0;
  const u = hitTable(d);
  return n < u.length ? u[n] : renewalLimit(d);
}

/** Exact chance of landing on every gate from index `next` on, with the token on `pos`. */
export function winChance(gates: readonly number[], d: Die, pos = 0, next = 0): number {
  if (next >= gates.length) return 1;
  let p = hitChance(gates[next] - pos, d);
  for (let i = next + 1; i < gates.length; i++) p *= hitChance(gates[i] - gates[i - 1], d);
  return p;
}

/** The fixed prize for landing on every gate. */
export const prizeFor = (gates: readonly number[], d: Die) => RTP / winChance(gates, d);

/** The fair cash-out in a live state: prize × P(win | state). */
export const cashValue = (gates: readonly number[], d: Die, pos: number, next: number) =>
  prizeFor(gates, d) * winChance(gates, d, pos, next);

/** What each face of the next roll does: falls short of the gate, lands on it, or jumps over it. */
export type FaceKind = 'short' | 'gate' | 'over';

export function faceKinds(gates: readonly number[], d: Die, pos: number, next: number): FaceKind[] {
  const g = gates[next];
  return Array.from({ length: d }, (_, i) => {
    const to = pos + i + 1;
    return to < g ? 'short' : to === g ? 'gate' : 'over';
  });
}

/** Chance that the next roll jumps over the next gate (the red faces). */
export const overshootChance = (gates: readonly number[], d: Die, pos: number, next: number) =>
  faceKinds(gates, d, pos, next).filter((k) => k === 'over').length / d;

export type RollOutcome = 'move' | 'gate' | 'win' | 'bust';

export interface Roll {
  face: number;
  from: number;
  to: number;
  /** Index of the next gate after the roll. */
  next: number;
  outcome: RollOutcome;
}

export function applyRoll(gates: readonly number[], pos: number, next: number, face: number): Roll {
  const to = pos + face;
  const g = gates[next];
  if (to > g) return { face, from: pos, to, next, outcome: 'bust' };
  if (to < g) return { face, from: pos, to, next, outcome: 'move' };
  const after = next + 1;
  return { face, from: pos, to, next: after, outcome: after >= gates.length ? 'win' : 'gate' };
}

/**
 * The chance the token lands on each square while the round is still alive
 * (index = square). Between the token and the next gate it is u(n − pos);
 * past a gate the profile restarts from that gate, scaled by the chance of
 * landing on it. So each gate's value is the chance of getting that far, and
 * the last gate's value is the win chance. Squares at or behind the token,
 * and past the last gate, are 0.
 */
export function landingProfile(gates: readonly number[], d: Die, pos: number, next: number): Float64Array {
  const out = new Float64Array(SQUARES);
  let base = 1;
  let from = pos;
  for (let i = next; i < gates.length; i++) {
    for (let n = from + 1; n <= gates[i]; n++) out[n] = base * hitChance(n - from, d);
    base = out[gates[i]];
    from = gates[i];
  }
  return out;
}

/** Moves the gate nearest to `square` onto it (the gate count never changes). */
export function moveGate(gates: readonly number[], square: number): number[] {
  if (square < 1 || square > LAST_SQUARE || gates.includes(square)) return [...gates];
  let best = 0;
  for (let i = 1; i < gates.length; i++) if (Math.abs(gates[i] - square) < Math.abs(gates[best] - square)) best = i;
  return gates.map((g, i) => (i === best ? square : g)).sort((a, b) => a - b);
}

/** k distinct gate squares, sorted, spread over the first part of the track. */
export function randomGates(k: number, rng: Rng, span = Math.min(LAST_SQUARE, 14 * k)): number[] {
  const picked = new Set<number>();
  while (picked.size < k) picked.add(1 + rng.int(span));
  return [...picked].sort((a, b) => a - b);
}

export function volatilityOf(p: number): Volatility {
  return p >= 0.25 ? 'low' : p >= 0.05 ? 'medium' : p >= 0.005 ? 'high' : 'extreme';
}

/** Honest bound: the prize is at most RTP · d^k (every u ≥ 1/d), and no cash-out exceeds the prize. */
export const MAX_MULTIPLIER = RTP * Math.max(...DICE) ** Math.max(...GATE_COUNTS);
