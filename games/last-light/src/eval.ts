import { defineEval, type Rng } from '@originals/game-sdk';
import { VOLATILITY, cashValue, defaultPicks, nextRisk, prize, startWalk, walkSegment, winChance, type PickCount, type Ring } from './math';

/** The lamps a simulated player backs: random ones, a run of neighbours, or the evenly spread default. */
function samplePicks(n: number, s: number, rng: Rng): number[] {
  const r = rng.next();
  if (r < 0.5) {
    return rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1)).slice(0, s);
  }
  if (r < 0.75) {
    const first = 1 + rng.int(n - s);
    return Array.from({ length: s }, (_, i) => first + i);
  }
  return defaultPicks(n, s);
}

// Each round samples the lamps and the player's habit: stop after a random
// number of walks, stop when the next light is too likely to be yours, take
// profit once the win chance passes a target, or play to the end.
export default defineEval<{ n: Ring; s: PickCount }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.n} lamps, back ${p.s})`,
    params: p,
  })),
  playRound({ n, s }, rng) {
    const picks = samplePicks(n, s, rng);
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? 1 + rng.int(8) : Infinity;
    const riskCap = habit >= 0.3 && habit < 0.55 ? 0.2 + 0.7 * rng.next() : 2;
    const target = habit >= 0.55 && habit < 0.75 ? 0.25 + 0.6 * rng.next() : 2;
    let w = startWalk(n);
    let steps = 0;
    for (;;) {
      const seg = walkSegment(w, picks, rng.next, false);
      steps++;
      if (seg.result === 'won') return { multiplier: prize(n, s), steps };
      if (seg.result === 'lost') return { multiplier: 0, steps };
      w = seg.end;
      if (steps >= stopAfter || nextRisk(w, picks) > riskCap || winChance(w, picks) >= target) {
        return { multiplier: cashValue(w, picks), steps };
      }
    }
  },
});
