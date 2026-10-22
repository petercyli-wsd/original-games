// Doors: a progressive Monty Hall where switching changes volatility, never value.
//
// One prize sits behind one of N doors, uniformly at random. You hold a door.
// The host knows where the prize is. At every step he opens one empty door
// you are not holding, uniformly among the eligible ones. When two doors are
// left closed, both are revealed and you win the prize locked on your door if
// it is behind it.
//
// Bayes' rule. Say c doors are closed before a step and the host opens door z.
// If the prize is behind your door, he chose z from c − 1 empty doors; if it is
// behind another closed door, from c − 2. So the opening is
//     w = (1/(c − 1)) / (1/(c − 2)) = (c − 2) / (c − 1)
// times as likely when you hold the prize. Give every door a weight r(x): it
// starts at 1, is multiplied by w at each opening while you hold it, and drops
// to 0 when the door is opened. The chance the prize is behind door x is then
// exactly
//     P(x) = r(x) / Σ r(closed doors).
// Hold one door all the way and the factors telescope: its weight ends at
// 1/(N − 1) and its chance never moves from 1/N (the Monty Hall lesson). The
// opened doors' chance flows only into the doors you are not holding.
//
// Pricing: a fixed prize with value-preserving relocks. The cash-out is
//     V = prize × P(your door) = RTP × E[payout | everything seen so far].
// P(your door) is a posterior probability, hence a martingale while you hold
// it, so V is a martingale starting at RTP = RTP·N × 1/N and, by optional
// stopping, every cash-out rule returns exactly RTP. Switching to door y keeps
// V and relocks the prize at V / P(y): a choice changes how much you can win
// and how likely you are to win it, never what the bet is worth.
//
// Closed forms. Let W be the product of every opening's factor w so far. By
// induction (an opening multiplies W and the held door's weight by the same w;
// a switch relocks at V / P), the prize locked on door x is always
//     prize(x) = RTP · N · W / r(x),   and   V = RTP · N · W / Σ r(closed).
// r(x) is a product of a subset of W's factors, all ≤ 1, so W ≤ r(x) and the
// prize can never exceed RTP · N. No cap is needed: maxMultiplier = RTP · 12.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** How many doors the prize hides among. More doors: a longer shot, a bigger prize. */
export const DOOR_COUNTS = [3, 5, 8, 12] as const;
export type DoorCount = (typeof DOOR_COUNTS)[number];

/**
 * Your move at the final two doors. "switch" flips your hold to the other door
 * automatically when two are left (you can flip back, or switch any door at any
 * checkpoint). It sets the headline odds: holding your first door wins 1/N and
 * pays RTP·N; switching at the end wins (N − 1)/N and pays RTP·N/(N − 1).
 * Same value, very different volatility.
 */
export const PLANS = ['stay', 'switch'] as const;
export type Plan = (typeof PLANS)[number];

export const VOLATILITY: Record<Volatility, { doors: DoorCount; plan: Plan }> = {
  low: { doors: 12, plan: 'switch' },
  medium: { doors: 3, plan: 'switch' },
  high: { doors: 5, plan: 'stay' },
  extreme: { doors: 12, plan: 'stay' },
};

/** Headline chance to win: hold your first door to the end, then stay or switch. */
export const planChance = (doors: number, plan: Plan) => (plan === 'stay' ? 1 / doors : (doors - 1) / doors);
/** Headline prize for that plan: RTP / chance (written as the prize the board locks, so both display alike). */
export const planPrize = (doors: number, plan: Plan) => (plan === 'stay' ? RTP * doors : (RTP * doors) / (doors - 1));

export function volatilityOf(doors: number, plan: Plan): Volatility {
  const p = planChance(doors, plan);
  return p >= 0.75 ? 'low' : p >= 0.5 ? 'medium' : p >= 0.15 ? 'high' : 'extreme';
}

export interface DoorsState {
  /** Bayes weight of each door; 0 once opened. P(prize behind x) = weight[x] / Σ weight. */
  weight: number[];
  /** The door you hold. */
  held: number;
  /** W: the product of every opening's factor (c − 2)/(c − 1) so far. */
  shrink: number;
}

export function newState(doors: number, held: number): DoorsState {
  return { weight: Array.from({ length: doors }, () => 1), held, shrink: 1 };
}

export const doorCount = (s: DoorsState) => s.weight.length;
export const isClosed = (s: DoorsState, door: number) => s.weight[door] > 0;
export const closedDoors = (s: DoorsState) => s.weight.flatMap((w, i) => (w > 0 ? [i] : []));
export const closedCount = (s: DoorsState) => s.weight.reduce((k, w) => k + (w > 0 ? 1 : 0), 0);
const totalWeight = (s: DoorsState) => s.weight.reduce((a, w) => a + w, 0);

/** The chance the prize is behind each door (0 for opened doors). Sums to 1. */
export function posterior(s: DoorsState): number[] {
  const t = totalWeight(s);
  return s.weight.map((w) => w / t);
}

export const chanceOf = (s: DoorsState, door: number) => s.weight[door] / totalWeight(s);

/** The chance your door hides the prize: the live win probability. */
export const winChance = (s: DoorsState) => chanceOf(s, s.held);

/** Cash-out value V = RTP · N · W / Σ r. It does not depend on which door you hold. */
export const cashValue = (s: DoorsState) => (RTP * doorCount(s) * s.shrink) / totalWeight(s);

/** The prize locked on door x if you hold it: V / P(x) = RTP · N · W / r(x) ≤ RTP · N. */
export function prizeOf(s: DoorsState, door: number): number {
  const cap = RTP * doorCount(s);
  return Math.min(cap, (cap * s.shrink) / s.weight[door]);
}

export const lockedPrize = (s: DoorsState) => prizeOf(s, s.held);

/** Bayes factor for the held door when one of c closed doors is opened. */
export const holdFactor = (closed: number) => (closed - 2) / (closed - 1);

/** Openings from N closed doors down to the final two. */
export const openingsFor = (doors: number) => doors - 2;

/** Whether the host still has a door to open (otherwise it is time to reveal). */
export const canOpen = (s: DoorsState) => closedCount(s) > 2;

/** Applies an opening: the held door's weight shrinks by w, the opened door drops to 0. */
export function openDoor(s: DoorsState, door: number): DoorsState {
  const c = closedCount(s);
  if (c <= 2 || door === s.held || s.weight[door] === 0) throw new Error(`door ${door} cannot be opened`);
  const w = holdFactor(c);
  const weight = s.weight.slice();
  weight[s.held] *= w;
  weight[door] = 0;
  return { weight, held: s.held, shrink: s.shrink * w };
}

/** Switches your hold. The cash-out is unchanged; the prize relocks at V / P(door). */
export function switchTo(s: DoorsState, door: number): DoorsState {
  if (!isClosed(s, door)) throw new Error(`door ${door} is open`);
  return { ...s, held: door };
}

/** The host's move: a uniformly random empty door you don't hold. */
export function hostPick(s: DoorsState, prizeDoor: number, rng: Rng): number {
  const eligible = closedDoors(s).filter((d) => d !== s.held && d !== prizeDoor);
  return eligible[rng.int(eligible.length)];
}

/**
 * The exact chance the host opens each door next (0 for doors he can't open),
 * averaging his uniform choice over where the prize may be.
 */
export function openChances(s: DoorsState): number[] {
  const c = closedCount(s);
  const post = posterior(s);
  return post.map((_, z) => {
    if (z === s.held || post[z] === 0 || c <= 2) return 0;
    let p = 0;
    for (let x = 0; x < post.length; x++) if (x !== z && post[x] > 0) p += post[x] / (x === s.held ? c - 1 : c - 2);
    return p;
  });
}

/** The closed door you don't hold with the best chance (lowest number on ties), or null. */
export function bestOther(s: DoorsState): number | null {
  let best: number | null = null;
  for (let d = 0; d < s.weight.length; d++) {
    if (d === s.held || s.weight[d] === 0) continue;
    if (best === null || s.weight[d] > s.weight[best] * (1 + 1e-12)) best = d;
  }
  return best;
}

/** The closed door you don't hold, at the final two. */
export const otherDoor = (s: DoorsState) => closedDoors(s).find((d) => d !== s.held)!;

/** Upper bound on any payout: the prize never exceeds RTP · N. */
export const maxMultiplier = (doors: number) => RTP * doors;
export const MAX_MULTIPLIER = Math.max(...DOOR_COUNTS.map(maxMultiplier));
