// One round of Scratch as pure state transitions. Balance and tickets live in
// the app; when `outcome` is set, `mult` is what the main ticket settles at
// (relative to the main bet) and every purchase ticket settles at 0.

import { canBuyAt, prizeMultiplier, sellMultiplier, type Setup } from './math';

export type CardState = 'hidden' | 'miss' | 'win';
export type Outcome = 'win' | 'sold' | 'lost';

export interface Round extends Setup {
  bet: number;
  /** Prize multiplier M. */
  prize: number;
  /** Index of the winning card. Hidden from the player until the round ends. */
  winner: number;
  board: CardState[];
  goesLeft: number;
  misses: number;
  /** Whether extra scratches may be bought (the variant switch). */
  buyEnabled: boolean;
  /** Amounts paid for extra scratches, in order. */
  buys: number[];
  /** Card scratched last, for the animation. */
  last: number | null;
  outcome: Outcome | null;
  /** Settlement multiplier of the main bet once the round is over. */
  mult: number;
}

export function startRound(setup: Setup, bet: number, winner: number, buyEnabled: boolean): Round {
  return {
    ...setup,
    bet,
    prize: prizeMultiplier(setup),
    winner,
    board: Array<CardState>(setup.cards).fill('hidden'),
    goesLeft: setup.goes,
    misses: 0,
    buyEnabled,
    buys: [],
    last: null,
    outcome: null,
    mult: 0,
  };
}

/** Cards still covered (while the round is live). */
export const cardsLeft = (r: Round) => r.cards - r.misses;

export const isLive = (r: Round) => r.outcome === null;

/** The player has missed with every go and must buy one or end the round. */
export const isOut = (r: Round) => isLive(r) && r.goesLeft === 0;

/** Current fair value of the goes held, as a multiple of the main bet. */
export const liveValue = (r: Round) => (isLive(r) ? sellMultiplier(r, r.goesLeft, cardsLeft(r)) : r.mult);

export const canSell = (r: Round) => isLive(r) && r.misses > 0 && r.goesLeft > 0;

export const canBuy = (r: Round) => isLive(r) && r.buyEnabled && r.misses > 0 && canBuyAt(r.goesLeft, cardsLeft(r));

export const totalSpent = (r: Round) => r.bet + r.buys.reduce((a, b) => a + b, 0);

/** Index of the i-th covered card (for "scratch random"). */
export function hiddenCards(r: Round): number[] {
  const out: number[] = [];
  r.board.forEach((c, i) => c === 'hidden' && out.push(i));
  return out;
}

export function scratch(r: Round, i: number): Round {
  if (!isLive(r) || r.goesLeft <= 0 || r.board[i] !== 'hidden') return r;
  const board = r.board.slice();
  if (i === r.winner) {
    board[i] = 'win';
    return { ...r, board, goesLeft: r.goesLeft - 1, last: i, outcome: 'win', mult: r.prize };
  }
  board[i] = 'miss';
  const next: Round = { ...r, board, goesLeft: r.goesLeft - 1, misses: r.misses + 1, last: i };
  // Out of goes with nothing left to buy: the round is lost.
  if (next.goesLeft === 0 && !canBuy(next)) return { ...next, outcome: 'lost', mult: 0 };
  return next;
}

export function sell(r: Round): Round {
  if (!canSell(r)) return r;
  return { ...r, outcome: 'sold', mult: liveValue(r) };
}

/** Records a purchase the wallet has already accepted. */
export function buy(r: Round, amount: number): Round {
  if (!canBuy(r)) return r;
  return { ...r, goesLeft: r.goesLeft + 1, buys: [...r.buys, amount] };
}

/** Out of goes and declining to buy another: the round is lost. */
export function decline(r: Round): Round {
  if (!isOut(r)) return r;
  return { ...r, outcome: 'lost', mult: 0 };
}
