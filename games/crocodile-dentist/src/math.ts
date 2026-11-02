// Payout maths.
//
// The jaw has a fixed N teeth (20, set in config.ts); the one knob is how many of them are bad
// (k). A round at n teeth left is: you press, then (if you survived) the House
// presses. Three outcomes:
//   you bitten            p = k/n                          -> lose
//   House bitten          p = (n-k)/n * k/(n-1)            -> pays `bite`
//   both safe             p = (n-k)/n * (n-k-1)/(n-1)      -> cash-out rises to `next`
//
// The House-bitten payout is a fixed BITE = 1.5 times the round's card value
// (`next`), so the House's press always moves the stakes both ways: a bite
// pays 1.5x the card, a safe press leaves you holding the card.
//
// Fairness (optional stopping). `cash` is set so cashing out is worth the same
// at every checkpoint, whatever you do afterwards:
//   cash = pHouse * BITE * next + pBoth * next
// i.e. next = cash / (pHouse * BITE + pBoth). The cash-out is then a martingale
// that starts at RTP, so every stopping strategy returns exactly RTP. When no
// good tooth is left after a round the game auto-cashes at `next` (a stopping
// rule, so RTP is unchanged). The player's press is never certain to bite:
// a round is only offered while at least one good tooth is left (n - k >= 1).
//
// The live "chance to win" (not getting bitten if you play to the end) is
// computed exactly by the recursion in `winChance`.

import type { Rng } from '@originals/game-sdk';

/** House-bitten payout = BITE x the round's card value. */
export const BITE = 1.5;

export interface Rung {
  n: number; // teeth left at the start of this round
  cash: number; // cash-out multiplier available before this round
  next: number; // cash-out multiplier if both survive this round
  bite: number; // multiplier paid if the House is bitten this round
  pYou: number;
  pHouse: number;
  pBoth: number;
}

export function buildLadder(N: number, k: number, J: number, rtp: number): Rung[] {
  const rungs: Rung[] = [];
  let n = N;
  let cash = rtp;
  while (n - k >= 1) {
    const pYou = k / n;
    const pHouse = ((n - k) / n) * (k / (n - 1));
    const pBoth = ((n - k) / n) * ((n - k - 1) / (n - 1));
    const next = cash / (pHouse * J + pBoth);
    rungs.push({ n, cash, next, bite: J * next, pYou, pHouse, pBoth });
    // If both survive this round no good teeth are left, so the game
    // auto-cashes at `next`.
    if (n - k - 2 <= 0) break;
    n -= 2;
    cash = next;
  }
  return rungs;
}

/** What surviving your press in this round is worth on its card: the cash-out
 *  if both can be safe, or the bite when the House is certain to be bitten. */
export const cardValue = (r: Rung) => (r.pBoth > 0 ? r.next : r.bite);

export function ladderStats(ladder: Rung[]) {
  let reach = 1;
  let win = 0;
  let max = 0;
  for (const r of ladder) {
    win += reach * r.pHouse;
    reach *= r.pBoth;
    max = Math.max(max, r.bite);
  }
  const last = ladder[ladder.length - 1];
  if (last && last.pBoth > 0) {
    win += reach;
    max = Math.max(max, last.next);
  }
  return { winChance: win, max };
}

/**
 * Exact chance of not getting bitten if you play to the end, from a state
 * with `n` teeth left (k bad) and `turn` to press. You win when the House is
 * bitten or when the good teeth run out (auto cash-out).
 */
export function winChance(n: number, k: number, turn: 'you' | 'house'): number {
  // Bottom-up from m = k teeth (no good tooth left: auto cash-out on your
  // turn, a certain bite on the House's), alternating turns:
  //   W_you(m)   = (m-k)/m * W_house(m-1)
  //   W_house(m) = k/m + (m-k)/m * W_you(m-1)
  let you = 1;
  let house = 1;
  for (let m = k + 1; m <= n; m++) [you, house] = [((m - k) / m) * house, k / m + ((m - k) / m) * you];
  return turn === 'you' ? you : house;
}

export function pickTraps(N: number, k: number, rng: Rng): number[] {
  return rng.shuffle(Array.from({ length: N }, (_, i) => i)).slice(0, k);
}

/** Highest payout reachable with any of the given settings. */
export function maxMultiplier(N: number, badTeeth: number[], rtp: number): number {
  let max = 0;
  for (const k of badTeeth.filter((x) => x < N)) max = Math.max(max, ladderStats(buildLadder(N, k, BITE, rtp)).max);
  return max;
}

export const fmtMult = (x: number) => x.toFixed(2) + '×';
export const fmtAmt = (x: number) => x.toFixed(8);
export const fmtPct = (x: number) => (x * 100).toFixed(1) + '%';
