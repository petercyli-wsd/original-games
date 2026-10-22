import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, countOf, deadChance, headline, playRound, prizeFor, startInformed, winChance, type Size } from './math';

// The simulated player plays the real process (Bet runs round 1, then one
// round per "Spread") and samples a stopping rule each round:
//   play to the end; stop after a random number of rounds; stop when the next
//   round's chance of putting everyone out of reach is above a threshold;
//   stop-loss when the win chance falls below a fraction of the start; or lock
//   in once the cash-out reaches a random multiple.
// Every one of these is a stopping rule on a martingale, so each returns RTP.
export default defineEval<{ n: Size; R: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.n} nodes, ${p.R} rounds)`, params: p })),
  playRound({ n, R }, rng) {
    const prize = prizeFor(n, R);
    const p0 = headline(n, R);

    const s = rng.next();
    let maxRounds = Infinity;
    let maxRisk = 1;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.3) {
      // play to the end
    } else if (s < 0.55) maxRounds = 1 + rng.int(R);
    else if (s < 0.72) maxRisk = 0.02 + 0.5 * rng.next();
    else if (s < 0.86) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.05 + 3 * rng.next();

    let informed = startInformed(n);
    for (let t = 1; ; t++) {
      informed = playRound(n, informed, rng).informed;
      const i = countOf(informed);
      const left = R - t;
      if (i === n) return { multiplier: prize, steps: t };
      const p = winChance(n, i, left);
      if (p === 0) return { multiplier: 0, steps: t };
      const cash = prize * p;
      if (t >= maxRounds || deadChance(n, i, left) > maxRisk || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: t };
    }
  },
});
