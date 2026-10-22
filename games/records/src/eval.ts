import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, advance, headline, isRecord, outOfReach, prizeFor, runWindow, winChance, type Items, type Pace } from './math';

// The simulated player plays the real moves (Bet reveals item 1, then "Next
// item" or "Run to the next record" at every checkpoint) and samples both a
// pace and a stopping rule each round:
//   pace:   always run, always step item by item, or a random choice per move;
//   stop:   play to the end, stop after a random number of moves, stop when the
//           next run's failure chance is above a threshold, stop-loss when the
//           win chance falls below a fraction of the start, or lock in once the
//           cash-out reaches a random multiple.
// Every one of these is a stopping rule on a martingale, so each returns RTP.
export default defineEval<{ n: Items; k: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.k}+ records in ${p.n})`, params: p })),
  playRound({ n, k }, rng) {
    const prize = prizeFor(n, k);
    const p0 = headline(n, k);

    const u = rng.next();
    const pace: Pace | 'mixed' = u < 0.5 ? 'run' : u < 0.62 ? 'item' : 'mixed';
    const s = rng.next();
    let maxMoves = Infinity;
    let maxRunRisk = 1;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxMoves = 1 + rng.int(10);
    else if (s < 0.72) maxRunRisk = 0.25 + 0.6 * rng.next();
    else if (s < 0.86) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.1 + 3 * rng.next();

    let seen = 0;
    let records = 0;
    let moves = 0;
    for (;;) {
      const mode: Pace = moves === 0 ? 'item' : pace === 'mixed' ? (rng.next() < 0.4 ? 'item' : 'run') : pace;
      const ranks = advance(n, k, seen, records, mode, rng);
      ranks.forEach((rank, i) => (records += isRecord(rank, seen + i + 1) ? 1 : 0));
      seen += ranks.length;
      moves++;

      if (records >= k) return { multiplier: prize, steps: moves };
      if (outOfReach(n, k, seen, records)) return { multiplier: 0, steps: moves };

      const p = winChance(n, k, seen, records);
      const cash = prize * p;
      const risk = 1 - (runWindow(n, k, seen, records)?.chance ?? 1);
      if (moves >= maxMoves || risk > maxRunRisk || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: moves };
    }
  },
});
