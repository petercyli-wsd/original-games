import { defineEval } from '@originals/game-sdk';
import { DIFFICULTY, PATTERNS, ROWS, buildTower, climb, multiplier, patternColumns, reachChance, type Difficulty } from './math';

// One config per volatility level; each round samples a difficulty in the
// level's band and one of the ways players actually play:
//   - Manual with a plan: climb to a fixed row, then cash out;
//   - Manual on feel: after each row, cash out with a fixed chance;
//   - Manual chasing a multiplier: climb until the cash-out reaches a target;
//   - Auto: a pattern (random / left / right / zigzag / custom) to a target row.
// Tiles are picked by pattern or at random against a real tower.
// Targets are kept where P(reach) ≥ the level's floor so 100k rounds measure
// the RTP well; it is exact for every stopping rule anyway (see math.ts).

const LEVELS: { label: string; band: Difficulty[]; floor: number }[] = [
  { label: 'low (Easy, 3 of 4 safe)', band: ['easy'], floor: 0 },
  { label: 'medium (Medium, 2 of 3 safe)', band: ['medium'], floor: 0 },
  { label: 'high (Hard, 1 of 2 safe)', band: ['hard'], floor: 1 / 300 },
  { label: 'extreme (Expert / Master, 1 safe)', band: ['expert', 'master'], floor: 1 / 1000 },
];

/** The highest row worth targeting: the largest k ≤ 9 with P(reach k) ≥ floor. */
function reach(d: Difficulty, floor: number) {
  let k = 1;
  while (k < ROWS && reachChance(d, k + 1) >= floor) k++;
  return k;
}

export default defineEval<{ band: Difficulty[]; floor: number }>({
  configs: LEVELS.map(({ label, band, floor }) => ({ label, params: { band, floor } })),
  playRound({ band, floor }, rng) {
    const d = band[rng.int(band.length)];
    const tiles = DIFFICULTY[d].tiles;
    const tower = buildTower(d, (xs) => rng.shuffle(xs));
    const kMax = reach(d, floor);
    const s = rng.next();

    if (s < 0.25) {
      // Auto: a pattern to a target row.
      const pattern = PATTERNS[rng.int(PATTERNS.length)].value;
      const custom = Array.from({ length: ROWS }, () => rng.int(tiles));
      const target = 1 + rng.int(kMax);
      const r = climb(tower, d, patternColumns(pattern, d, target, custom, (n) => rng.int(n)));
      return { multiplier: r.multiplier, steps: r.picks.length };
    }

    let stop: (k: number) => boolean;
    if (s < 0.5) {
      const target = 1 + rng.int(kMax);
      stop = (k) => k >= target;
    } else if (s < 0.75) {
      const q = 0.15 + 0.5 * rng.next();
      stop = (k) => k >= kMax || rng.next() < q;
    } else {
      const top = multiplier(d, kMax);
      const target = Math.exp(Math.log(1.05) + rng.next() * (Math.log(top) - Math.log(1.05)));
      stop = (k) => k >= kMax || multiplier(d, k) >= target;
    }

    // The first row is mandatory; cash out is offered after each safe row.
    let k = 0;
    do {
      const col = rng.next() < 0.5 ? rng.int(tiles) : k % tiles;
      if (!tower[k][col]) return { multiplier: 0, steps: k + 1 };
      k++;
    } while (k < ROWS && !stop(k));
    return { multiplier: multiplier(d, k), steps: k };
  },
});
