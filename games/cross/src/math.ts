// Cross: a 12-card deck laid out as a 3 × 4 grid (rows are 3 colours, columns
// are 4 shapes). Cards are turned in a uniformly random order. The first card
// is free; after it, every turned card must differ from the card before it in
// both colour and shape (it must miss that card's row and column: the "cross").
// Survive k turns and you win.
//
// State: the set D of turned cards, the current card c (the last one turned)
// and the turns still to survive t. The next card is uniform over the m = 12 − |D|
// cards left, so the exact win chance is the finite recursion (a DP over at most
// 2¹² subsets × 12 current cards, memoised):
//
//   P(0, D, c) = 1
//   P(t, D, c) = (1/m) · Σ_{x ∉ D, x off the cross of c} P(t − 1, D ∪ {x}, x).
//
// A card on the cross contributes 0 (the round is lost), so the chance the next
// card is safe is exactly (green cards) / (cards left), the count on the board.
// By the symmetry of the grid (permute rows, permute columns) the start chance
// P₀(k) does not depend on which card comes first: 6/11 = 54.5% for k = 1, then
// 27.3%, 13.9%, 3.9% and 0.67% for k = 2, 3, 5, 8.
//
// Pricing (fixed prize): prize = RTP / P₀(k), cash-out(state) = prize · P(state).
// The recursion above says E[P after the next card | now] = P now, so the
// cash-out is a martingale that starts at RTP; by optional stopping every
// cash-out rule (manual or Auto) returns exactly RTP. Each remaining card is
// tinted with P(after it), and the tints average to the chance now: that is the
// same recursion read off the board.
//
// Dead ends: near the bottom of the deck a safe card can leave a state from
// which no order of the cards left survives (P = 0, e.g. the last two cards
// share a colour). Such a state is worth 0, so the round ends there as a loss;
// the card's tint showed 0% before it was turned. The mirror case, P = 1 (every
// order of the cards left survives), is played out automatically with no
// checkpoint: cashing out there would pay the prize anyway. Both are stopping
// rules, so the RTP is unchanged, and no draw is ever offered at certain loss.
// Both only happen with 8 turns, in under 0.1% of rounds. A draw with no red
// card left (free) can still be a real decision, since later turns are not.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const ROWS = 3;
export const COLS = 4;
export const CARDS = ROWS * COLS;

/** Turns to survive after the free first card. */
export const TURNS = [1, 2, 3, 5, 8] as const;
export type Turns = (typeof TURNS)[number];

export const VOLATILITY: Record<Volatility, Turns> = {
  low: 1,
  medium: 2,
  high: 5,
  extreme: 8,
};

export const rowOf = (card: number) => Math.floor(card / COLS);
export const colOf = (card: number) => card % COLS;
export const bit = (card: number) => 1 << card;

/** True when b lies on a's cross: same row (colour) or same column (shape), b ≠ a. */
export const onCross = (a: number, b: number) => a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b));

/** The cards not yet turned, in grid order. */
export function remaining(mask: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < CARDS; x++) if (!(mask & bit(x))) out.push(x);
  return out;
}

export const popcount = (mask: number) => {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
};

// Memo over (turns left, turned set, current card). t ≤ 8 keeps it to 9 × 4096 × 12 entries.
const MEMO = new Float64Array(9 * (1 << CARDS) * CARDS).fill(-1);

/** Exact P(survive t more turns | turned set `mask`, current card `cur`). */
export function chance(t: number, mask: number, cur: number): number {
  if (t <= 0) return 1;
  const key = (t * (1 << CARDS) + mask) * CARDS + cur;
  const hit = MEMO[key];
  if (hit >= 0) return hit;
  let m = 0;
  let sum = 0;
  for (let x = 0; x < CARDS; x++) {
    if (mask & bit(x)) continue;
    m++;
    if (!onCross(cur, x)) sum += chance(t - 1, mask | bit(x), x);
  }
  const p = m === 0 ? 0 : sum / m;
  MEMO[key] = p;
  return p;
}

/** Turns still to survive once `turned` cards (the first card included) are down. */
export const turnsLeft = (k: number, turned: number) => k - (turned - 1);

/** Win chance at the start of a round: any first card gives the same chance. */
export const startChance = (k: number) => chance(k, bit(0), 0);

/** The full-win prize for k turns. */
export const prizeFor = (k: number) => RTP / startChance(k);

/** Win chance of a round state given by the cards turned so far, in order. */
export function winChance(k: number, order: readonly number[]): number {
  if (order.length === 0) return startChance(k);
  const mask = order.reduce((a, c) => a | bit(c), 0);
  return chance(turnsLeft(k, order.length), mask, order[order.length - 1]);
}

/** Fair cash-out value of a round state. */
export const cashOutFor = (k: number, order: readonly number[]) => prizeFor(k) * winChance(k, order);

/** The largest payout of any setting: the 8-turn prize. */
export const MAX_MULTIPLIER = prizeFor(8);

export interface NextCard {
  card: number;
  /** On the cross of the current card: turning it ends the round. */
  killer: boolean;
  /** Win chance if this card comes next (0 for a killer). */
  after: number;
}

/** What each card left would do to the win chance if it came next. */
export function nextCards(k: number, order: readonly number[]): NextCard[] {
  const mask = order.reduce((a, c) => a | bit(c), 0);
  const cur = order[order.length - 1];
  const t = turnsLeft(k, order.length);
  return remaining(mask).map((card) => {
    const killer = onCross(cur, card);
    return { card, killer, after: killer ? 0 : chance(t - 1, mask | bit(card), card) };
  });
}

/** Chance the next card is off the cross: green cards over cards left. */
export function safeShare(order: readonly number[]): { safe: number; left: number } {
  const mask = order.reduce((a, c) => a | bit(c), 0);
  const cur = order[order.length - 1];
  const left = remaining(mask);
  return { safe: left.filter((x) => !onCross(cur, x)).length, left: left.length };
}

/** Turns the next card from a uniform u in [0, 1): the ⌊u·m⌋-th card left in grid order. */
export function drawCard(u: number, mask: number): number {
  const left = remaining(mask);
  return left[Math.min(left.length - 1, Math.floor(u * left.length))];
}

export function volatilityOf(k: number): Volatility {
  const p = startChance(k);
  return p > 0.3 ? 'low' : p > 0.1 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

