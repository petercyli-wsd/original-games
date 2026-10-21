// Payout maths.
//
// N teeth, k of them bad, pressed one at a time without replacement. After j
// safe presses the cash-out multiplier is the fair price of surviving them:
//   P(survive j) = C(N-k, j) / C(N, j)
//   mult(j)      = rtp / P(survive j)
// so cashing out after any number of presses is worth exactly the RTP.

import type { Rng } from '@originals/game-sdk';

export interface Step {
  press: number; // 1-based press number
  pBite: number; // chance this press bites, given you got this far
  reach: number; // chance of surviving every press up to and including this one
  mult: number; // cash-out multiplier once this press is safe
}

export function buildLadder(N: number, k: number, rtp: number): Step[] {
  const steps: Step[] = [];
  let reach = 1;
  for (let j = 0; j < N - k; j++) {
    const n = N - j; // teeth left before this press
    const pBite = k / n;
    reach *= 1 - pBite;
    steps.push({ press: j + 1, pBite, reach, mult: rtp / reach });
  }
  return steps;
}

export function pickTraps(N: number, k: number, rng: Rng): number[] {
  return rng.shuffle(Array.from({ length: N }, (_, i) => i)).slice(0, k);
}

/** Highest payout reachable with any of the given settings (pressing every good tooth). */
export function maxMultiplier(teeth: number[], badTeeth: number[], rtp: number): number {
  let max = 0;
  for (const N of teeth)
    for (const k of badTeeth.filter((x) => x < N)) {
      const ladder = buildLadder(N, k, rtp);
      max = Math.max(max, ladder[ladder.length - 1].mult);
    }
  return max;
}

export const fmtMult = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)) + '×';
export const fmtAmt = (x: number) => x.toFixed(8);
export const fmtPct = (x: number) => (x * 100 < 0.1 && x > 0 ? '<0.1' : (x * 100).toFixed(1)) + '%';
