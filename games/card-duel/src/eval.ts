import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, duel, forecast, front, isYours, prizeFor, start, winChance, winner } from './math';

// Each simulated player mixes the ways people play: stop after a random number
// of duels (or play to the end), cash out once the cash-out passes a target
// (the Auto rule), and stop when the next duel could cut the chance too much.
export default defineEval<{ n: number }>({
  configs: Object.entries(VOLATILITY).map(([level, v]) => ({
    label: `${level} (${v.n} house cards)`,
    params: v,
  })),
  playRound({ n }, rng) {
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(8);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.15 + rng.next() * 0.5 : 1;
    const prize = prizeFor(n);
    let c = start(n);
    let steps = 0;
    for (;;) {
      const { a, b } = front(c);
      c = duel(c, isYours(rng.next(), a, b));
      steps++;
      const w = winner(c);
      if (w) return { multiplier: w === 'you' ? prize : 0, steps };
      const now = winChance(c);
      const cash = prize * now;
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      const f = forecast(c);
      if (1 - Math.min(f.ifYou, f.ifHouse) / now > dropCap) return { multiplier: cash, steps };
    }
  },
});
