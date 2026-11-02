import { defineEval } from '@originals/game-sdk';
import { N, VOLATILITY, drawRank, headline, isRecord, outOfReach, prizeFor, recordChance, winChance } from './math';

// The simulated player plays the real move (Bet reveals item 1, then "Next
// item" at every checkpoint) and samples a stopping rule each round: play to
// the end, stop after a random number of items, stop once the next item's
// record chance falls below a threshold while records are still needed,
// stop-loss when the win chance falls below a fraction of the start, or lock
// in once the cash-out reaches a random multiple. Every one of these is a
// stopping rule on a martingale, so each returns RTP.
export default defineEval<{ k: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.k}+ records in ${N})`, params: p })),
  playRound({ k }, rng) {
    const prize = prizeFor(k);
    const p0 = headline(k);

    const s = rng.next();
    let maxMoves = Infinity;
    let minNext = 0;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxMoves = 1 + rng.int(12);
    else if (s < 0.72) minNext = 1 / (4 + rng.int(14));
    else if (s < 0.86) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.1 + 3 * rng.next();

    let seen = 0;
    let records = 0;
    for (;;) {
      seen++;
      if (isRecord(drawRank(seen, rng), seen)) records++;

      if (records >= k) return { multiplier: prize, steps: seen };
      if (outOfReach(k, seen, records)) return { multiplier: 0, steps: seen };

      const p = winChance(k, seen, records);
      const cash = prize * p;
      if (seen >= maxMoves || recordChance(seen + 1) < minNext || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: seen };
    }
  },
});
