// Payout maths.
//
// A round at n teeth (k of them bad) is: you press, then (if you survived) the
// House presses. Three outcomes:
//   you bitten            p = k/n                          -> lose
//   House bitten          p = (n-k)/n * k/(n-1)            -> pays `bite`
//   both safe             p = (n-k)/n * (n-k-1)/(n-1)      -> cash-out rises to `next`
//
// `cash` is chosen so cashing out is worth the same (RTP x bet) at every
// checkpoint, whatever you do afterwards:
//   cash = pHouse * J * next + pBoth * next
// so next = cash / (pHouse * J + pBoth), and bite = J * next.

import type { Rng } from '@originals/game-sdk';

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

export function pickTraps(N: number, k: number, rng: Rng): number[] {
  return rng.shuffle(Array.from({ length: N }, (_, i) => i)).slice(0, k);
}

/** Highest payout reachable with any of the given settings. */
export function maxMultiplier(teeth: number[], badTeeth: number[], biteBonuses: number[], rtp: number): number {
  let max = 0;
  for (const N of teeth)
    for (const k of badTeeth.filter((x) => x < N))
      for (const J of biteBonuses) max = Math.max(max, ladderStats(buildLadder(N, k, J, rtp)).max);
  return max;
}

export const fmtMult = (x: number) => x.toFixed(2) + '×';
export const fmtAmt = (x: number) => x.toFixed(8);
export const fmtPct = (x: number) => (x * 100).toFixed(1) + '%';
