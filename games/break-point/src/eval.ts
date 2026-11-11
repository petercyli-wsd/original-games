import { defineEval } from '@originals/game-sdk';
import { EMPTY, VOLATILITY, addPoint, forecast, isYours, prizeFor, winChance, winner } from './math';

// Each simulated player mixes the ways people play: stop after a random number
// of points (or play to the end), cash out once the cash-out passes a target
// (the Auto rule), and stop when the next point could cut the chance too much.
export default defineEval<{ p: number }>({
  configs: Object.entries(VOLATILITY).map(([level, v]) => ({
    label: `${level} (server ${Math.round(v.p * 100)}%)`,
    params: v,
  })),
  playRound({ p }, rng) {
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(8);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.15 + rng.next() * 0.5 : 1;
    const prize = prizeFor(p);
    let x = EMPTY;
    let steps = 0;
    for (;;) {
      x = addPoint(x, isYours(rng.next(), p));
      steps++;
      const w = winner(x);
      if (w) return { multiplier: w === 'you' ? prize : 0, steps };
      const now = winChance(x, p);
      const cash = prize * now;
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      const f = forecast(x, p);
      if (1 - Math.min(f.ifYou, f.ifServer) / now > dropCap) return { multiplier: cash, steps };
    }
  },
});
