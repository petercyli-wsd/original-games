// Rock Paper Scissors (the duel format from Stake and others).
//
// Each throw you pick a hand and the house picks one of the three uniformly at
// random, independently of you. Whatever you pick, exactly one house hand
// beats you, one ties and one loses to you, so every throw is a win, a draw or
// a loss with probability exactly 1/3 each. Your choice of hand never changes
// the odds.
//
// The draw rule is the risk knob:
//   Easy     a draw counts as a win: a throw advances the streak w.p. 2/3, ×1.5
//   Classic  a draw is replayed:     the next decided throw is a win w.p. 1/2, ×2
//   Hard     a draw busts:           a throw advances w.p. 1/3, ×3
//
// Pricing (one edge, applied once): after k streak steps the cash-out is
//   cash(k) = RTP · f^k,  f = 3 / (number of advancing outcomes),
// so the first Classic win pays 0.99 × 2 = 1.98× and each further win doubles.
// Every single throw is a fair bet. Enumerating the three house hands:
//   Easy     (1/3)(1.5c) + (1/3)(1.5c) + (1/3)·0 = c
//   Classic  (1/3)(2c)   + (1/3)(c)    + (1/3)·0 = c   (a draw keeps c)
//   Hard     (1/3)(3c)   + (1/3)·0     + (1/3)·0 = c
// The cash-out is therefore a bounded martingale starting at RTP = 0.99, and by
// optional stopping every strategy (any hands, any cash-out rule, the max-streak
// auto cash-out) returns exactly 99%. In closed form, stopping at k steps pays
// RTP · f^k with probability p^k = f^-k, which is RTP for every k.
// (Stake compounds 0.99 on every win; ours keeps a single 1% edge.)

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const HANDS = ['rock', 'paper', 'scissors'] as const;
export type Hand = 0 | 1 | 2;
export const HAND_NAMES = ['Rock', 'Paper', 'Scissors'] as const;
export const HAND_KEYS = ['R', 'P', 'S'] as const;

export type Outcome = 'win' | 'draw' | 'lose';

/** Paper (1) beats rock (0), scissors (2) beat paper (1), rock (0) beats scissors (2). */
export function outcomeOf(player: Hand, house: Hand): Outcome {
  const d = (player - house + 3) % 3;
  return d === 0 ? 'draw' : d === 1 ? 'win' : 'lose';
}

/** The hand that beats h. */
export const beats = (h: Hand): Hand => ((h + 1) % 3) as Hand;

export type Risk = 'easy' | 'classic' | 'hard';
export type Effect = 'advance' | 'replay' | 'bust';

export interface RiskSpec {
  label: string;
  /** What a draw does. */
  draw: Effect;
  /** Chance the streak advances before it busts. */
  p: number;
  /** Cash-out factor per streak step: exactly 1/p. */
  factor: number;
  /** Longest streak; reaching it cashes out automatically. */
  maxSteps: number;
  vol: Volatility;
  /** One line for the panel. */
  blurb: string;
}

export const RISKS: Record<Risk, RiskSpec> = {
  easy: { label: 'Easy', draw: 'advance', p: 2 / 3, factor: 1.5, maxSteps: 25, vol: 'low', blurb: 'Draws count as wins · ×1.5 per step' },
  classic: { label: 'Classic', draw: 'replay', p: 1 / 2, factor: 2, maxSteps: 20, vol: 'medium', blurb: 'Draws replay · ×2 per win' },
  hard: { label: 'Hard', draw: 'bust', p: 1 / 3, factor: 3, maxSteps: 12, vol: 'high', blurb: 'Draws bust · ×3 per win' },
};
export const RISK_ORDER: Risk[] = ['easy', 'classic', 'hard'];

/** What a throw's outcome does to the streak under a draw rule. */
export function effectOf(risk: Risk, o: Outcome): Effect {
  return o === 'win' ? 'advance' : o === 'lose' ? 'bust' : RISKS[risk].draw;
}

/** How many of the three equally likely house hands advance, replay or bust: the odds strip on screen. */
export function oddsStrip(risk: Risk): Record<Effect, number> {
  const counts: Record<Effect, number> = { advance: 0, replay: 0, bust: 0 };
  for (const house of [0, 1, 2] as Hand[]) counts[effectOf(risk, outcomeOf(0, house))]++;
  return counts;
}

/** Cash-out multiplier after k streak steps (k = 0 is the stake's fair value, not cashable). */
export function cashAfter(risk: Risk, k: number): number {
  let m = RTP;
  for (let i = 0; i < k; i++) m *= RISKS[risk].factor;
  return m;
}

/** The ladder of cash-outs for steps 1..maxSteps. */
export function ladder(risk: Risk): number[] {
  return Array.from({ length: RISKS[risk].maxSteps }, (_, i) => cashAfter(risk, i + 1));
}

/** Chance of reaching a streak of k from the start: p^k. */
export const reachChance = (risk: Risk, k: number) => RISKS[risk].p ** k;

export const MAX_MULTIPLIER = Math.max(...RISK_ORDER.map((r) => cashAfter(r, RISKS[r].maxSteps)));

export interface Throw {
  player: Hand;
  house: Hand;
  outcome: Outcome;
  effect: Effect;
}

/** Plays one throw: the house hand comes from the rng (uniform over three). */
export function playThrow(risk: Risk, player: Hand, rng: Rng): Throw {
  const house = rng.int(3) as Hand;
  const outcome = outcomeOf(player, house);
  return { player, house, outcome, effect: effectOf(risk, outcome) };
}

export type Pick = Hand | 'random';

export const pickHand = (pick: Pick, rng: Rng): Hand => (pick === 'random' ? (rng.int(3) as Hand) : pick);

export interface RoundResultFull {
  multiplier: number;
  steps: number;
  throws: Throw[];
}

/**
 * One automatic round, as Auto plays it: throw `pick` until the streak reaches
 * `target` (cash out there) or busts. A safety cap on throws is unnecessary in
 * practice (draws only replay in Classic, with chance 1/3 each).
 */
export function autoRound(risk: Risk, target: number, pick: Pick, rng: Rng): RoundResultFull {
  const t = Math.max(1, Math.min(RISKS[risk].maxSteps, Math.floor(target)));
  const throws: Throw[] = [];
  let k = 0;
  while (k < t) {
    const th = playThrow(risk, pickHand(pick, rng), rng);
    throws.push(th);
    if (th.effect === 'bust') return { multiplier: 0, steps: throws.length, throws };
    if (th.effect === 'advance') k++;
  }
  return { multiplier: cashAfter(risk, k), steps: throws.length, throws };
}

export function volatilityOf(risk: Risk): Volatility {
  return RISKS[risk].vol;
}
