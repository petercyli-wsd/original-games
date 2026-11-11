import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, advance, cashOf, headline, popcount, winChance, type K } from './math';

// The simulated player plays the real steps (Bet makes the first step, then
// Roll at every checkpoint; a step rolls through repeats until a new total or a
// 7 shows) and samples a stopping rule each round: play to the end, stop after
// a random number of steps, stop below a win chance, stop-loss at a fraction of
// the start, or lock in at a random multiple. Each is a stopping rule on a
// martingale, so each returns RTP. "steps" counts those presses.
export default defineEval<{ k: K }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (k = ${p.k})`, params: p })),
  playRound({ k }, rng) {
    const p0 = headline(k);
    const s = rng.next();
    let maxSteps = Infinity;
    let minChance = 0;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.35) {
      // play to the end
    } else if (s < 0.6) maxSteps = 1 + rng.int(k);
    else if (s < 0.75) minChance = 0.1 + 0.5 * rng.next();
    else if (s < 0.88) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.05 + 3 * rng.next();

    let mask = 0;
    let steps = 0;
    for (;;) {
      const r = advance(mask, rng);
      mask = r.mask;
      steps++;
      const last = r.rolls[r.rolls.length - 1];
      if (last.kind === 'seven') return { multiplier: 0, steps };
      if (popcount(mask) >= k) return { multiplier: cashOf(k, mask, false), steps };
      const p = winChance(k, mask);
      const cash = cashOf(k, mask, false);
      if (steps >= maxSteps || p < minChance || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps };
    }
  },
});
