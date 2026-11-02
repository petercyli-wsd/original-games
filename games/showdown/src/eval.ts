import { defineEval } from '@originals/game-sdk';
import { START, TARGETS, chanceOf, drawPair, forecast, play, prizeFor, settled, volatilityOf, type Target } from './math';

// Each simulated player mixes the ways people play: stop after a random
// number of rounds (or play to the end), bank once the cash-out passes a
// target (the Auto rule), or stop when losing the next round would cut the
// chance by more than they can stomach. Nobody chooses cards, so there are
// no other choices to sample.
export default defineEval<{ k: Target }>({
  configs: TARGETS.map((k) => ({ label: `${volatilityOf(k)} (take ${k} of 7)`, params: { k } })),
  playRound({ k }, rng) {
    const prize = prizeFor(k);
    const stopAfter = rng.next() < 0.4 ? Infinity : 1 + rng.int(6);
    const cashAt = rng.next() < 0.25 ? 1.05 + rng.next() * 8 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.1 + rng.next() * 0.6 : 1;

    let s = START;
    let steps = 0;
    for (;;) {
      const { i, j } = drawPair(s, rng.next(), rng.next());
      s = play(s, i, j);
      steps++;
      const r = settled(s, k);
      if (r) return { multiplier: r === 'win' ? prize : 0, steps };
      const p = chanceOf(s, k);
      const cash = prize * p;
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      // Risk stop: on average, losing the next round would cut the chance by more than dropCap.
      const f = forecast(s, k);
      if (f.ifLose && 1 - f.ifLose.mean / p > dropCap) return { multiplier: cash, steps };
    }
  },
});
