import { defineEval } from '@originals/game-sdk';
import { CELLS, RESPINS, START, TARGET, VOLATILITY, headline, prizeFor, winChance } from './math';

// The simulated player spins, then at every checkpoint cashes out or spins on.
// Each round samples a stopping rule: play to the end, stop after a random
// number of spins, stop when the win chance falls below a fraction of the
// start, or lock in once the cash-out reaches a random multiple of the stake.
// Every one is a stopping rule on a martingale, so each returns RTP.
export default defineEval<{ L: number }>({
  configs: RESPINS.map((L) => ({ label: `${VOLATILITY[L]} (${L} respins)`, params: { L } })),
  playRound({ L }, rng) {
    const prize = prizeFor(L);
    const p0 = headline(L);
    const s = rng.next();
    let maxSpins = Infinity;
    let stopLoss = 0;
    let lockIn = Infinity;
    if (s < 0.4) {
      // play to the end
    } else if (s < 0.65) maxSpins = 1 + rng.int(20);
    else if (s < 0.85) stopLoss = p0 * (0.2 + 0.6 * rng.next());
    else lockIn = 1.05 + 3 * rng.next();

    let coins = START;
    let l = L;
    let spins = 0;
    for (;;) {
      spins++;
      if (rng.int(CELLS) >= coins) {
        coins++;
        l = L;
      } else l--;
      if (coins >= TARGET) return { multiplier: prize, steps: spins };
      if (l === 0) return { multiplier: 0, steps: spins };
      const p = winChance(coins, l, L);
      const cash = prize * p;
      if (spins >= maxSpins || p < stopLoss || cash >= lockIn) return { multiplier: cash, steps: spins };
    }
  },
});
