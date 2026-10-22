import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, DIFFICULTY_LABEL, POPS, VOLATILITY_OF, maxPumps, multiplier, popChance, survival, drawPositions, playToTarget } from './math';

/**
 * The deepest rung the eval plays to. Easy goes all the way (1 in 25); on the
 * harder ladders the top rungs are so rare (1 in 3.3 million on Expert) that a
 * finite sample can't see them, so sampled stops go no deeper than a rung
 * reached at least 0.3% of the time. Every stop is worth exactly 99% (see the
 * tests), so this only keeps the estimate's error honest.
 */
export function deepest(d: number): number {
  let k = maxPumps(d);
  while (k > 1 && survival(d, k) < 0.003) k--;
  return k;
}

/** Sampled player behaviour: the pump the player would cash out after. */
export function sampleTarget(d: number, u: number, v: number, intN: (n: number) => number): number {
  const T = deepest(d);
  if (u < 0.35) return 1 + intN(T); // a random fixed number of pumps
  if (u < 0.55) {
    // Keep pumping while the next pop chance stays under a personal limit.
    const cap = 0.05 + 0.5 * v;
    let k = 1;
    while (k < T && popChance(d, k) <= cap) k++;
    return k;
  }
  if (u < 0.8) {
    // Cash out at the first rung that reaches a target multiplier.
    const hi = Math.log(Math.min(500, multiplier(d, T)));
    const goal = Math.exp(Math.log(1.05) + v * (hi - Math.log(1.05)));
    let k = 1;
    while (k < T && multiplier(d, k) < goal) k++;
    return k;
  }
  return T; // pump to the end (of the sampled ladder)
}

export default defineEval<{ pops: number }>({
  configs: DIFFICULTIES.map((x) => ({ label: `${VOLATILITY_OF[x]} (${DIFFICULTY_LABEL[x]}, ${POPS[x]} pop${POPS[x] > 1 ? 's' : ''})`, params: { pops: POPS[x] } })),
  playRound({ pops }, rng) {
    const positions = drawPositions(rng, pops);
    const target = sampleTarget(pops, rng.next(), rng.next(), rng.int);
    const { pumps, multiplier: m } = playToTarget(positions, pops, target);
    return { multiplier: m, steps: pumps };
  },
});
