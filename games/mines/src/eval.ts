import { defineEval } from '@originals/game-sdk';
import { TILES, gemsFor, multiplier, nextSafe, placeMines, playSelection, surviveChance } from './math';

// One config per volatility level; each round samples a mine count in the
// level's band and one of the strategies players actually use:
//   - a fixed number of gems, then cash out (Manual with a plan);
//   - keep going while the next tile is at least θ safe (risk threshold);
//   - keep going until the cash-out reaches a target multiplier;
//   - an Auto bet: a random preset tile set revealed in order;
//   - with a single mine, also clearing the whole board.
// Tiles are picked at random or in reading order against a real placement.
// Targets are kept where P(reach) ≥ the level's floor so 100k rounds measure it well;
// the RTP itself is exact for every stopping rule (see math.ts).

// `floor` is how far each level's players push: the deepest target they aim
// for still has P(reach) ≥ floor (cautious low-mine players stop sooner).
const LEVELS = [
  { label: 'low (1–2 mines)', mines: [1, 2], floor: 0.3 },
  { label: 'medium (3–5 mines)', mines: [3, 4, 5], floor: 0.05 },
  { label: 'high (8–12 mines)', mines: [8, 10, 12], floor: 1 / 150 },
  { label: 'extreme (18–24 mines)', mines: [18, 20, 22, 24], floor: 1 / 1000 },
];

/** The most gems worth targeting: the largest k with P(k) ≥ floor. */
function reach(mines: number, floor: number) {
  let k = 1;
  while (k < gemsFor(mines) && surviveChance(mines, k + 1) >= floor) k++;
  return k;
}

export default defineEval<{ mines: number[]; floor: number }>({
  configs: LEVELS.map(({ label, mines, floor }) => ({ label, params: { mines, floor } })),
  playRound({ mines: band, floor }, rng) {
    const m = band[rng.int(band.length)];
    const board = placeMines(m, (xs) => rng.shuffle(xs));
    const kMax = reach(m, floor);
    const ordered = rng.next() < 0.5;
    const order = ordered ? Array.from({ length: TILES }, (_, i) => i) : rng.shuffle(Array.from({ length: TILES }, (_, i) => i));

    const s = rng.next();
    if (s < 0.2) {
      // Auto: a preset set of tiles.
      const set = order.slice(0, 1 + rng.int(kMax));
      const r = playSelection(board, m, set);
      return { multiplier: r.multiplier, steps: r.revealed.length };
    }

    let stop: (k: number) => boolean;
    if (s < 0.45) {
      const target = m === 1 && rng.next() < 0.25 ? gemsFor(m) : 1 + rng.int(kMax);
      stop = (k) => k >= target;
    } else if (s < 0.7) {
      const theta = 0.5 + 0.45 * rng.next();
      stop = (k) => k >= kMax || nextSafe(m, k) < theta;
    } else {
      const top = multiplier(m, kMax);
      const target = Math.exp(Math.log(1.05) + rng.next() * (Math.log(top) - Math.log(1.05)));
      stop = (k) => k >= kMax || multiplier(m, k) >= target;
    }

    let k = 0;
    // The first reveal is mandatory; cash out is only offered after a gem.
    do {
      if (board[order[k]]) return { multiplier: 0, steps: k + 1 };
      k++;
    } while (k < gemsFor(m) && !stop(k));
    return { multiplier: multiplier(m, k), steps: k };
  },
});
