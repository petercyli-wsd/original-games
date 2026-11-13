import { defineEval } from '@originals/game-sdk';
import { TARGETS, forecast, prizeFor, slotFor, start, take, winChance, winner } from './math';

// Each simulated player mixes the ways people play: stop after a random number
// of chips (or play to the end), cash out once the cash-out passes a target
// (the Auto rule), and stop when the next chip could cut the chance too much.
export default defineEval<{ k: number }>({
  configs: TARGETS.map((k) => ({ label: `fill ${k}`, params: { k } })),
  playRound({ k }, rng) {
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(8);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.15 + rng.next() * 0.5 : 1;
    const prize = prizeFor(k);
    let s = start(k);
    let steps = 0;
    for (;;) {
      s = take(s, slotFor(s, rng.next()));
      steps++;
      const w = winner(s);
      if (w) return { multiplier: w === 'you' ? prize : 0, steps };
      const now = winChance(s);
      const cash = prize * now;
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      const f = forecast(s);
      if (1 - f.ifWhite / now > dropCap) return { multiplier: cash, steps };
    }
  },
});
