import { defineEval } from '@originals/game-sdk';
import { TARGETS, pickFor, prizeFor, start, take, winChance, winner } from './math';

// Each simulated player mixes the ways people play: stop after a random number
// of ticks (or play to the end), and cash out once the cash-out passes a target
// (the Auto rule).
export default defineEval<{ k: number }>({
  configs: TARGETS.map((k) => ({ label: `get ${k}`, params: { k } })),
  playRound({ k }, rng) {
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(8);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const prize = prizeFor(k);
    let s = start(k);
    let steps = 0;
    for (;;) {
      s = take(s, pickFor(s, rng.next()));
      steps++;
      const w = winner(s);
      if (w) return { multiplier: w === 'you' ? prize : 0, steps };
      const cash = prize * winChance(s);
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
    }
  },
});
