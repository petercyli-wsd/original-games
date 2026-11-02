// Sixes: roll n dice up to three times. Any die that shows a six stays put;
// the others are rolled again. You win if every die shows a six.
//
// Each die runs its own race to a six, independent of the others. A free die
// with r rolls left fails only if all r of its rolls miss, so it makes a six
// with chance
//
//   p_r = 1 − (5/6)^r        (geometric distribution: first six on roll k
//                             with chance (5/6)^(k−1) · 1/6)
//
// and by independence (the product rule) the chance that all f free dice
// make it is
//
//   P(win | f free, r rolls left) = p_r^f.
//
// Holding sixes is automatic, so there is no choice to get wrong. The board
// draws exactly these quantities: one bar per die (p_r, or 100% for a six)
// and the product of the bars is the win chance.
//
// Pricing (fixed prize): prize = RTP / P₀ with P₀ = (91/216)^n, and the
// cash-out at any state is prize × P(win | state). The roll outcome is a
// binomial count of new sixes, and
//
//   Σ_k C(f,k) (1/6)^k (5/6)^(f−k) · p_(r−1)^(f−k) = (1/6 + 5/6·p_(r−1))^f = p_r^f,
//
// so the cash-out is a martingale starting at RTP. By optional stopping
// every cash-out strategy returns exactly RTP. A roll is never certain to
// lose while r ≥ 1, so every offered roll is a real bet.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Rolls per round. */
export const ROLLS = 3;

/** Dice counts the player can choose. More dice: lower chance, bigger prize. */
export const DICE = [1, 2, 3, 4, 5] as const;
export type DiceCount = (typeof DICE)[number];

export const VOLATILITY: Record<Volatility, DiceCount> = {
  low: 1,
  medium: 2,
  high: 3,
  extreme: 5,
};

/** Chance that one free die shows a six within r rolls: 1 − (5/6)^r. */
export const dieChance = (r: number) => (r <= 0 ? 0 : 1 - (5 / 6) ** r);

/** Chance one die first shows a six on the k-th of the rolls left (k = 1 is the next roll). */
export const sixOnRoll = (k: number) => (5 / 6) ** (k - 1) / 6;

/** Exact chance that all f free dice show a six within r rolls. */
export function winChance(free: number, rollsLeft: number): number {
  if (free <= 0) return 1;
  return dieChance(rollsLeft) ** free;
}

/** Chance to win at the start, before the first roll. */
export const startChance = (n: number) => winChance(n, ROLLS);

/** The full-win prize for n dice. */
export const prizeFor = (n: number) => RTP / startChance(n);

/** Fair cash-out value with f free dice and r rolls left. */
export const cashOutFor = (n: number, free: number, rollsLeft: number) => prizeFor(n) * winChance(free, rollsLeft);

/** The largest payout of any setting: the 5-dice prize. */
export const MAX_MULTIPLIER = prizeFor(5);

const binom = (n: number, k: number) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

export interface NextRollOutcome {
  /** New sixes on this roll. */
  sixes: number;
  /** Chance of exactly this many new sixes. */
  prob: number;
  /** Win chance after the roll. */
  win: number;
}

/** What the next roll of f free dice (with r rolls left, including it) can do to the win chance. */
export function nextRoll(free: number, rollsLeft: number): NextRollOutcome[] {
  const out: NextRollOutcome[] = [];
  for (let k = 0; k <= free; k++) {
    out.push({
      sixes: k,
      prob: binom(free, k) * (1 / 6) ** k * (5 / 6) ** (free - k),
      win: winChance(free - k, rollsLeft - 1),
    });
  }
  return out;
}

/** Rolls one die from a uniform u in [0, 1): a face from 1 to 6. */
export const face = (u: number) => 1 + Math.min(5, Math.floor(u * 6));

export function volatilityOf(n: number): Volatility {
  const p = startChance(n);
  return p > 0.3 ? 'low' : p > 0.1 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}
