import { defineEval } from '@originals/game-sdk';
import { LANES, buildRoad, cross, multiplier, reachableLane, type Difficulty } from './math';

// One config per difficulty (= volatility level). Each round samples one of
// the ways players actually play:
//   - Auto: a target lane, crossed in one go;
//   - Manual with a plan: cross to a fixed lane, then cash out;
//   - Manual on feel: after each lane, cash out with a fixed chance;
//   - Manual chasing a multiplier: cross until the cash-out reaches a target;
//   - Manual all the way: go for the far kerb.
// Every round crosses a real, independently drawn road. Targets stay where
// P(reach) ≥ the level's floor so 100k rounds measure the RTP well; the RTP is
// exact for every stopping rule anyway (see math.ts).

const LEVELS: { label: string; difficulty: Difficulty; floor: number }[] = [
  { label: 'low (Easy, 1 in 25 hit)', difficulty: 'easy', floor: 0 },
  { label: 'medium (Medium, 3 in 25)', difficulty: 'medium', floor: 0 },
  { label: 'high (Hard, 5 in 25)', difficulty: 'hard', floor: 1 / 200 },
  { label: 'extreme (Daredevil, 10 in 25)', difficulty: 'daredevil', floor: 1 / 1000 },
];

export default defineEval<{ difficulty: Difficulty; floor: number }>({
  configs: LEVELS.map(({ label, difficulty, floor }) => ({ label, params: { difficulty, floor } })),
  playRound({ difficulty: d, floor }, rng) {
    const road = buildRoad(d, (n) => rng.int(n));
    const kMax = reachableLane(d, floor);
    const s = rng.next();

    if (s < 0.25) {
      const r = cross(road, d, 1 + rng.int(kMax));
      return { multiplier: r.multiplier, steps: r.lanes };
    }

    let stop: (k: number) => boolean;
    if (s < 0.5) {
      const target = 1 + rng.int(kMax);
      stop = (k) => k >= target;
    } else if (s < 0.75) {
      const q = 0.1 + 0.4 * rng.next();
      stop = (k) => k >= kMax || rng.next() < q;
    } else if (s < 0.92) {
      const top = multiplier(d, kMax);
      const target = Math.exp(Math.log(1.02) + rng.next() * (Math.log(top) - Math.log(1.02)));
      stop = (k) => k >= kMax || multiplier(d, k) >= target;
    } else {
      stop = (k) => k >= kMax;
    }

    // The first lane is mandatory; cash out is offered after each safe lane.
    let k = 0;
    do {
      if (road[k]) return { multiplier: 0, steps: k + 1 };
      k++;
    } while (k < LANES && !stop(k));
    return { multiplier: multiplier(d, k), steps: k };
  },
});
