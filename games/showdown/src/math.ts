/**
 * Showdown maths.
 *
 * You hold the even cards 2, 4, …, 14 and the house the odd cards 1, 3, …, 13,
 * each in a shuffled face-down pile. Each round both sides flip one card, the
 * higher card takes the round (there are no ties: evens never meet odds), and
 * you win the series if you take k of the 7 rounds.
 *
 * Theorem (exchangeability of a random matching). Flipping both piles to the
 * end pairs your 7 cards with the house's 7 by a uniformly random bijection,
 * whatever order the pairs come out in. So from any state (your remaining
 * cards A, the house's remaining cards H, rounds still needed r) the chance of
 * winning is the chance that a uniform random matching of A against H has at
 * least r pairs where your card is higher:
 *
 *   W(A, H, r) = 1                       if r ≤ 0
 *              = 0                       if r > |A|
 *              = (1/|A|) Σ_{b ∈ H} W(A − a*, H − b, r − [a* > b])   otherwise,
 *
 * where a* is any fixed card of A (we use the lowest): its partner is uniform
 * on H. This is an exact DP over at most 2⁷ · 2⁷ · 8 states, cached.
 *
 * Pricing (fixed prize, pattern 1). Choosing k fixes P₀ = W(all, all, k) and
 * the prize RTP / P₀. At every checkpoint the cash-out is prize × W(state).
 * The next round draws one of the |A|² pairs uniformly, and by the law of
 * total probability W(state) is the average of W over those |A|² next states,
 * so the cash-out is a martingale starting at RTP; by optional stopping every
 * cash-out strategy returns exactly RTP. The player never chooses a card, so
 * there is no choice that could move the value.
 *
 * The round ends as soon as W is 0 or 1 (the tally is reached, the house has
 * taken too many, or the cards left settle it either way). No flip is played
 * after that: when the cards left settle it, reasonFor names the cards that
 * make the result certain instead of flipping them out. Tie rule: W is a
 * rational with denominator dividing 7!, so any value within 1e-12 of 0 or 1
 * is exactly 0 or 1.
 */

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** Cards per pile, and rounds per series. */
export const N = 7;
/** Card values: index i is your 2(i+1), the house's 2i+1. */
export const YOU = [2, 4, 6, 8, 10, 12, 14] as const;
export const HOUSE = [1, 3, 5, 7, 9, 11, 13] as const;
export const FULL = (1 << N) - 1;

/** Your card i beats the house's card j exactly when 2i + 2 > 2j + 1, i.e. i ≥ j. */
export const beats = (i: number, j: number) => i >= j;

/**
 * Targets on offer: 74%, 26% and 2.4% to win (1.34x, 3.80x, 41.2x). Taking 3
 * of 7 is left out (97.6% for 1.01x is not a bet), and so is 7 of 7 (it needs
 * the one exact matching, so any round won with room to spare loses it).
 */
export const TARGETS = [4, 5, 6] as const;
export type Target = (typeof TARGETS)[number];

export const VOLATILITY: Partial<Record<Volatility, { k: Target }>> = {
  low: { k: 4 },
  medium: { k: 5 },
  high: { k: 6 },
};
export const volatilityOf = (k: Target): Volatility => (k === 4 ? 'low' : k === 5 ? 'medium' : 'high');

/** Rounds the house must take to knock you out with target k. */
export const houseNeeds = (k: number) => N + 1 - k;

export function ruleFor(k: number | string) {
  return `Each round you and the house flip a card from your face-down piles, the higher card takes the round, and you win if you take ${k} of the 7 rounds.`;
}
/** The rule with k left as a letter (for the lobby). */
export const RULE = ruleFor('k');

export const popcount = (m: number) => {
  let c = 0;
  for (let x = m; x; x &= x - 1) c++;
  return c;
};

/** Indices of the set bits of a mask, ascending. */
export function cardsOf(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (mask & (1 << i)) out.push(i);
  return out;
}

const memo = new Map<number, number>();

/** W(A, H, r): the chance a random matching of A against H gives you at least r rounds. */
export function winChance(you: number, house: number, need: number): number {
  if (need <= 0) return 1;
  const n = popcount(you);
  if (need > n) return 0;
  const key = (you * 128 + house) * 8 + need;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  // The lowest card left in your pile; its partner is uniform on the house's pile.
  let a = 0;
  while (!(you & (1 << a))) a++;
  let sum = 0;
  for (const b of cardsOf(house)) sum += winChance(you & ~(1 << a), house & ~(1 << b), need - (beats(a, b) ? 1 : 0));
  const p = sum / n;
  memo.set(key, p);
  return p;
}

export interface State {
  /** Masks of the cards still in each pile. */
  you: number;
  house: number;
  /** Rounds taken so far. */
  wins: number;
  losses: number;
}

export const START: State = { you: FULL, house: FULL, wins: 0, losses: 0 };

export const roundsPlayed = (s: State) => s.wins + s.losses;

/** P(win the series | state) for target k. */
export const chanceOf = (s: State, k: number) => winChance(s.you, s.house, k - s.wins);

/** The fixed prize for target k: RTP / P₀(k). */
export const prizeFor = (k: number) => RTP / chanceOf(START, k);

/** Every payout is at most the prize, and the largest prize is the hardest target's. */
export const MAX_MULTIPLIER = Math.max(...TARGETS.map(prizeFor));

const EPS = 1e-12;

/** 'win' or 'lose' once the series can no longer change, else null. */
export function settled(s: State, k: number): 'win' | 'lose' | null {
  const p = chanceOf(s, k);
  if (p >= 1 - EPS) return 'win';
  if (p <= EPS) return 'lose';
  return null;
}

/** Plays your card i against the house's card j. */
export function play(s: State, i: number, j: number): State {
  const win = beats(i, j);
  return {
    you: s.you & ~(1 << i),
    house: s.house & ~(1 << j),
    wins: s.wins + (win ? 1 : 0),
    losses: s.losses + (win ? 0 : 1),
  };
}

/** The flip: each side's card is uniform on its own pile (two independent uniforms). */
export function drawPair(s: State, u1: number, u2: number): { i: number; j: number } {
  const ys = cardsOf(s.you);
  const hs = cardsOf(s.house);
  return { i: ys[Math.floor(u1 * ys.length)], j: hs[Math.floor(u2 * hs.length)] };
}

export interface Cell {
  /** Your card index and the house's card index. */
  i: number;
  j: number;
  win: boolean;
}

/** The pair grid: every (your card, house card) pair still possible, all equally likely next round. */
export function grid(s: State): Cell[] {
  const cells: Cell[] = [];
  for (const j of cardsOf(s.house)) for (const i of cardsOf(s.you)) cells.push({ i, j, win: beats(i, j) });
  return cells;
}

/** The share of (your card, house card) pairings where yours is higher: your exact chance of taking the next round. */
export function roundChance(s: State): { green: number; total: number; p: number } {
  const cells = grid(s);
  const green = cells.filter((c) => c.win).length;
  return { green, total: cells.length, p: cells.length ? green / cells.length : 0 };
}

export interface Branch {
  /** Average, lowest and highest series chance after this round result. */
  mean: number;
  min: number;
  max: number;
  /** How many of the equally likely pairs give this result. */
  cells: number;
}

export interface Forecast {
  pRound: number;
  ifWin: Branch | null;
  ifLose: Branch | null;
}

/**
 * What the next flip would do to your series chance: over the green cells
 * (you take the round) and the other cells (the house does). The two means,
 * weighted by their cell counts, average back to the chance now.
 */
export function forecast(s: State, k: number): Forecast {
  const acc = { win: [] as number[], lose: [] as number[] };
  for (const c of grid(s)) acc[c.win ? 'win' : 'lose'].push(chanceOf(play(s, c.i, c.j), k));
  const branch = (xs: number[]): Branch | null =>
    xs.length ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs), cells: xs.length } : null;
  const total = acc.win.length + acc.lose.length;
  return { pRound: total ? acc.win.length / total : 0, ifWin: branch(acc.win), ifLose: branch(acc.lose) };
}

/** Whether the tally itself has ended the series (you reached k, or the house reached 8 − k). */
export const tallyDone = (s: State, k: number) => s.wins >= k || s.losses >= houseNeeds(k);

export type Side = 'you' | 'house';

/**
 * Why the cards left settle a series before the tally does. `cards` (on side
 * `side`) are certain to go one way: each of them can only be beaten (or only
 * beat) the `only` cards on the other side, so at least |cards| − |only| of
 * their rounds go the same way whatever the order. That is `sure` rounds, and
 * `need` is how many such rounds settle it (rounds you still need to win, or
 * lost rounds you can still afford + 1).
 */
export interface Reason {
  outcome: 'win' | 'lose';
  /** Whose cards are certain: in a win, your cards that win or the house's that lose; in a loss the reverse. */
  side: Side;
  /** True when `cards` take their rounds (winners), false when they give them away (losers). */
  winners: boolean;
  /** Card indices on `side`, most telling first. */
  cards: number[];
  /** Card indices on the other side that could go against `cards`. */
  only: number[];
  sure: number;
  need: number;
}

/**
 * The plainest reason the cards left decide the series, or null if the series
 * is still open or the tally already ended it. The rounds certain to go one
 * way equal the deficiency of a matching (König), and since each card's
 * winning pairs are a threshold, the worst set is always a top or bottom run
 * of one hand. We try every such run and keep the one naming the fewest cards.
 */
export function reasonFor(s: State, k: number): Reason | null {
  const outcome = settled(s, k);
  if (!outcome || tallyDone(s, k)) return null;
  const ys = cardsOf(s.you);
  const hs = cardsOf(s.house);
  const need = outcome === 'win' ? k - s.wins : houseNeeds(k) - s.losses;
  // Does card a (on `side`) go the way the outcome needs against card b on the other side?
  const goes = (side: Side, a: number, b: number) => {
    const youWin = side === 'you' ? beats(a, b) : beats(b, a);
    return outcome === 'win' ? youWin : !youWin;
  };
  let best: Reason | null = null;
  // Win: your top cards (winners) or the house's bottom cards (losers). Lose: the house's top cards or your bottom cards.
  const runs: { side: Side; winners: boolean; order: number[] }[] =
    outcome === 'win'
      ? [
          { side: 'you', winners: true, order: [...ys].reverse() },
          { side: 'house', winners: false, order: hs },
        ]
      : [
          { side: 'house', winners: true, order: [...hs].reverse() },
          { side: 'you', winners: false, order: ys },
        ];
  for (const { side, winners, order } of runs) {
    const other = side === 'you' ? hs : ys;
    for (let m = 1; m <= order.length; m++) {
      let cards = order.slice(0, m);
      const only = other.filter((b) => cards.some((a) => !goes(side, a, b)));
      const sure = cards.length - only.length;
      if (sure < need) continue;
      // With nothing against them, any `need` of the cards make the point.
      if (only.length === 0) cards = cards.slice(0, need);
      const r: Reason = { outcome, side, winners, cards, only, sure: only.length ? sure : need, need };
      const size = (x: Reason) => x.cards.length + x.only.length * 1.5;
      if (!best || size(r) < size(best)) best = r;
      break;
    }
  }
  return best;
}

const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** "13", "13 and 11", "13, 11 and 9". */
function list(vals: number[], join: string) {
  return vals.length < 2 ? `${vals[0]}` : `${vals.slice(0, -1).join(', ')} ${join} ${vals[vals.length - 1]}`;
}

/**
 * The reason in words, e.g. "the house's 13 and 11 beat every card you have
 * left, and you can't afford 2 more lost rounds".
 */
export function reasonText(r: Reason): string {
  const value = (side: Side) => (i: number) => (side === 'you' ? YOU[i] : HOUSE[i]);
  const otherSide: Side = r.side === 'you' ? 'house' : 'you';
  const whose = (side: Side) => (side === 'you' ? 'your' : "the house's");
  const cards = r.cards.map(value(r.side));
  const only = r.only.map(value(otherSide));
  const one = cards.length === 1;
  let why: string;
  if (only.length === 0) {
    const rest = otherSide === 'you' ? 'every card you have left' : 'every card the house has left';
    const verb = r.winners ? (one ? 'beats' : 'beat') : one ? 'loses to' : 'lose to';
    why = `${whose(r.side)} ${list(cards, 'and')} ${verb} ${rest}`;
  } else {
    // At least `sure` of the named cards go the stated way: there are too few `only` cards to stop them all.
    const n = words[r.sure] ?? `${r.sure}`;
    const single = r.sure === 1;
    const verb = !r.winners ? (single ? 'loses' : 'lose') : r.side === 'house' ? (single ? 'beats you' : 'beat you') : single ? 'wins' : 'win';
    why = r.winners
      ? `only ${whose(otherSide)} ${list(only, 'and')} can beat ${whose(r.side)} ${list(cards, 'or')}, so at least ${n} of them ${verb}`
      : `${whose(r.side)} ${list(cards, 'and')} can beat only ${whose(otherSide)} ${list(only, 'and')}, so at least ${n} of them ${verb}`;
  }
  const then =
    r.outcome === 'win'
      ? r.need === 1
        ? 'and you need only one more round'
        : `and you need only ${r.need} more rounds`
      : r.need === 1
        ? "and you can't afford another lost round"
        : `and you can't afford ${r.need} more lost rounds`;
  return `${why}, ${then}`;
}

/** Auto cash-out targets (null = play every series to the end). */
export const CASH_AT = [null, 1.5, 2, 5, 10] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface Flip {
  i: number;
  j: number;
  /** The state after this round. */
  s: State;
}

export interface AutoResult {
  flips: Flip[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/**
 * One whole Auto series: flip until it is settled, or cash out as soon as the
 * cash-out reaches `cashAt` (a stopping rule, so RTP is unchanged).
 */
export function autoRound(k: Target, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(k);
  let s = START;
  const flips: Flip[] = [];
  for (;;) {
    const { i, j } = drawPair(s, u(), u());
    s = play(s, i, j);
    flips.push({ i, j, s });
    const r = settled(s, k);
    if (r) return { flips, multiplier: r === 'win' ? prize : 0, outcome: r };
    const cash = prize * chanceOf(s, k);
    if (cashAt !== null && cash >= cashAt) return { flips, multiplier: cash, outcome: 'cashed' };
  }
}
