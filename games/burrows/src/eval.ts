import { defineEval } from '@originals/game-sdk';
import { autoClimb, maxFinds, playRound, reachChance, value, BURROWS } from './math';

// One config per volatility level; each round samples a critter count in the
// level's band and one of the ways players play:
//   - Manual with a plan: tap until k finds, then cash out;
//   - Manual on feel: after each find, cash out with a fixed chance;
//   - Manual chasing a multiplier: tap until the cash-out reaches a target;
//   - Auto: a preset burrow sequence of length k.
// Targets are kept where P(reach) >= the level's floor so 100k rounds measure
// the RTP well; it is exact for every stopping rule anyway (see math.ts).

const LEVELS: { label: string; band: number[]; floor: number }[] = [
  { label: 'low (5 or 6 critters)', band: [5, 6], floor: 1 / 50 },
  { label: 'medium (4 critters)', band: [4], floor: 1 / 100 },
  { label: 'high (3 critters)', band: [3], floor: 1 / 300 },
  { label: 'extreme (1 or 2 critters)', band: [1, 2], floor: 1 / 1000 },
];

/** The highest find count worth targeting: the largest k <= cap with P(reach k) >= floor. */
function reach(m: number, floor: number) {
  let k = 1;
  while (k < maxFinds(m) && reachChance(m, k + 1) >= floor) k++;
  return k;
}

export default defineEval<{ band: number[]; floor: number }>({
  configs: LEVELS.map(({ label, band, floor }) => ({ label, params: { band, floor } })),
  playRound({ band, floor }, rng) {
    const m = band[rng.int(band.length)];
    const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);
    const kMax = reach(m, floor);
    const s = rng.next();
    const random = () => rng.int(BURROWS);

    let r;
    if (s < 0.25) {
      const k = 1 + rng.int(kMax);
      r = autoClimb(m, Array.from({ length: k }, random), shuffle);
    } else if (s < 0.5) {
      const k = 1 + rng.int(kMax);
      r = playRound(m, shuffle, random, (n) => n >= k);
    } else if (s < 0.75) {
      const q = 0.15 + 0.5 * rng.next();
      r = playRound(m, shuffle, random, (n) => n >= kMax || rng.next() < q);
    } else {
      const top = value(m, kMax);
      const target = Math.exp(Math.log(1.05) + rng.next() * (Math.log(top) - Math.log(1.05)));
      r = playRound(m, shuffle, random, (n) => n >= kMax || value(m, n) >= target);
    }
    return { multiplier: r.multiplier, steps: r.taps.length };
  },
});
