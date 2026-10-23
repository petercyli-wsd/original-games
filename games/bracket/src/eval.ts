import { defineEval } from '@originals/game-sdk';
import {
  RTP,
  emptyResults,
  isAlive,
  makeBracket,
  nextMatch,
  playMatch,
  prizeFor,
  switchPrize,
  titleOdds,
  withResult,
  type Field,
  type Preset,
} from './math';

interface Params {
  n: Field;
  preset: Preset;
  /** Seeds (1-based) the simulated player backs, picked at random each round. */
  seeds: number[];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Each round samples the player: which seed to back (from the config's
// range), whether to switch seeds at random checkpoints, and when to stop:
// play to the end, stop after a random number of matches, cash out once the
// title chance drops below a floor, or take a profit at a target multiplier.
export default defineEval<Params>({
  configs: [
    { label: 'low (8 seeds, Steep, back seed 1)', params: { n: 8, preset: 'steep', seeds: [1] } },
    { label: 'medium (8 seeds, Even, any seed)', params: { n: 8, preset: 'even', seeds: range(1, 8) } },
    { label: 'high (16 seeds, Underdog, seeds 4–12)', params: { n: 16, preset: 'underdog', seeds: range(4, 12) } },
    { label: 'extreme (16 seeds, Steep, seeds 9–16)', params: { n: 16, preset: 'steep', seeds: range(9, 16) } },
  ],
  playRound({ n, preset, seeds }, rng) {
    const b = makeBracket(n, preset);
    let held = seeds[rng.int(seeds.length)] - 1;
    let prize = prizeFor(n, preset, held);
    let res = emptyResults(b);

    const style = rng.next();
    const stopAfter = style < 0.3 ? Infinity : style < 0.55 ? 1 + rng.int(n - 1) : Infinity;
    const floor = style >= 0.55 && style < 0.75 ? 0.3 + rng.next() * 0.5 : 0;
    const profitAt = style >= 0.75 ? RTP * (1.2 + rng.next() * 6) : Infinity;
    const switcher = rng.next() < 0.3;

    let steps = 0;
    let p0 = titleOdds(b, res)[held];
    for (;;) {
      const ref = nextMatch(b, res, held);
      if (!ref) return { multiplier: prize, steps };
      res = withResult(res, ref, playMatch(b, res, ref, rng.next()));
      steps++;
      if (!isAlive(b, res, held)) return { multiplier: 0, steps };
      const odds = titleOdds(b, res);
      if (!nextMatch(b, res, held)) return { multiplier: prize, steps };

      // A checkpoint: maybe switch, then decide whether to stop.
      if (switcher && rng.next() < 0.25) {
        const live = odds.map((p, i) => (p > 0 && i !== held ? i : -1)).filter((i) => i >= 0);
        const to = live[rng.int(live.length)];
        const np = switchPrize(prize * odds[held], odds[to]);
        if (np !== null) {
          prize = np;
          held = to;
          p0 = odds[to];
        }
      }
      const cash = prize * odds[held];
      if (steps >= stopAfter || odds[held] < floor * p0 || cash >= profitAt) return { multiplier: cash, steps };
    }
  },
});
