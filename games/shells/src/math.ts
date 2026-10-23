// Shells: follow the ball under the cups; blind swaps blur where it is.
//
// n cups stand in a row of slots (3–5). The ball starts under the leftmost
// cup, in plain sight. The dealer then makes MOVES moves. Each move picks one
// of the n − 1 neighbouring pairs of slots uniformly at random. A visible move
// swaps the two cups in plain sight. A blind move covers the pair first, and
// under the cover the cups swap with probability ½. The schedule of which
// moves are blind is fixed by the settings and drawn on the board.
// You back a slot; you win if the ball ends under the cup standing there.
//
// Belief (where the ball is now). Let p be the posterior over slots given
// everything seen. A visible swap of (a, a+1) permutes p; a blind swap of
// (a, a+1) replaces both entries by their average (the coin is never seen).
//
// Odds (where the ball ends). Before a move the pair is uniform, so the
// expected update is the Markov matrix M: a ball moves to each neighbour with
// chance 1/(n − 1) on a visible move, 1/(2(n − 1)) on a blind one. With r
// moves left the chance that slot s ends with the ball is
//     P(s) = (p · M_{t+1} · … · M_k)[s],
// computed exactly by pushing p through the remaining (tiny) matrices. Every
// probability here is a dyadic rational, so 0 is exactly 0.
//
// Pricing: a fixed prize. Backing slot s at the start locks
// prize = RTP / P₀(s); the cash-out is V = prize × P(s). P(s) is a posterior
// expectation of the final indicator, hence a martingale: averaging the next
// move's n − 1 equally likely pairs gives p · M, and therefore P(s) again. So
// V is a martingale starting at RTP, and by optional stopping every cash-out
// rule returns exactly RTP. Switching to slot t keeps V and relocks the prize
// at V / P(t), so a switch changes volatility, never value. A switch that
// would lock a prize above MAX_WIN is refused (a choice withheld, not a
// payout cut), so no payout can exceed MAX_WIN.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const CUPS = [3, 4, 5] as const;
export type Cups = (typeof CUPS)[number];

/** Moves per shuffle. */
export const MOVES = 6;

/** How many of the moves are blind. */
export const BLINDS = [0, 2, 4, 6] as const;
export type Blinds = (typeof BLINDS)[number];

/** No switch may lock a prize above this. */
export const MAX_WIN = 1000;

export interface Setup {
  cups: Cups;
  blinds: Blinds;
  /** The slot you back (0 = leftmost, where the ball starts). */
  slot: number;
}

export const VOLATILITY: Record<Volatility, Setup> = {
  low: { cups: 3, blinds: 2, slot: 0 },
  medium: { cups: 4, blinds: 2, slot: 2 },
  high: { cups: 5, blinds: 0, slot: 3 },
  extreme: { cups: 5, blinds: 6, slot: 4 },
};

/** Which moves are blind: `blinds` of them, spread evenly through the shuffle. */
export function schedule(blinds: number): boolean[] {
  const s = Array.from({ length: MOVES }, () => false);
  for (let i = 0; i < blinds; i++) s[Math.floor(((i + 0.5) * MOVES) / blinds)] = true;
  return s;
}

/** The ball starts under the leftmost cup, in plain sight. */
export function startBelief(cups: number): number[] {
  return Array.from({ length: cups }, (_, i) => (i === 0 ? 1 : 0));
}

/** The belief after the dealer moves the pair (pair, pair + 1). */
export function applyMove(p: readonly number[], pair: number, blind: boolean): number[] {
  const q = p.slice();
  if (blind) q[pair] = q[pair + 1] = (p[pair] + p[pair + 1]) / 2;
  else [q[pair], q[pair + 1]] = [p[pair + 1], p[pair]];
  return q;
}

/** p · M: the belief averaged over the next move's equally likely pairs. */
export function expectMove(p: readonly number[], blind: boolean): number[] {
  const n = p.length;
  const pairs = n - 1;
  const q = Array.from({ length: n }, () => 0);
  for (let a = 0; a < pairs; a++) {
    const r = applyMove(p, a, blind);
    for (let i = 0; i < n; i++) q[i] += r[i] / pairs;
  }
  return q;
}

/** The chance the ball ends under each slot, with moves `done…MOVES−1` still to come. */
export function finalChances(p: readonly number[], sched: readonly boolean[], done: number): number[] {
  let q = p.slice();
  for (let t = done; t < sched.length; t++) q = expectMove(q, sched[t]);
  return q;
}

export const startChances = (cups: number, blinds: number) => finalChances(startBelief(cups), schedule(blinds), 0);

/**
 * Your chance after each possible next move (one entry per neighbouring pair,
 * all equally likely). Their average is your chance now.
 */
export function nextOdds(p: readonly number[], sched: readonly boolean[], done: number, slot: number): number[] {
  if (done >= sched.length) return [];
  const pairs = p.length - 1;
  return Array.from({ length: pairs }, (_, a) => finalChances(applyMove(p, a, sched[done]), sched, done + 1)[slot]);
}

/** The dealer's move: a uniform neighbouring pair, and (if blind) whether the cups really swapped. */
export function drawMove(rng: Rng, cups: number, blind: boolean): { pair: number; swapped: boolean } {
  const pair = rng.int(cups - 1);
  return { pair, swapped: blind ? rng.next() < 0.5 : true };
}

/** Where the real ball goes when (pair, pair + 1) is moved. */
export function moveBall(ball: number, pair: number, swapped: boolean): number {
  if (!swapped) return ball;
  if (ball === pair) return pair + 1;
  if (ball === pair + 1) return pair;
  return ball;
}

/** Whether you may switch to a slot with chance pt when the bet is worth v. */
export const canSwitch = (v: number, pt: number) => pt > 0 && v / pt <= MAX_WIN * (1 + 1e-12);

export function volatilityOf(p: number): Volatility {
  return p > 0.25 ? 'low' : p > 0.08 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** The largest prize any setting locks at the start (every slot is reachable). */
export const MAX_START_PRIZE = Math.max(...CUPS.flatMap((n) => BLINDS.flatMap((b) => startChances(n, b).map((p) => RTP / p))));

/** Payouts never exceed the locked prize, and no prize is ever locked above this. */
export const MAX_MULTIPLIER = Math.max(MAX_WIN, MAX_START_PRIZE);
