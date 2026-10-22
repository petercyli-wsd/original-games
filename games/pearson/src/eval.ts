import { defineEval } from '@originals/game-sdk';
import { HOME_LABEL, RTP, VOLATILITY, dist, homeChance, prizeFor, stepFrom, verdict, type Home, type Pt, type Steps } from './math';

// Each simulated player follows one of four stopping rules, sampled per
// round, so the eval covers very different strategies:
//   - walk to the end,
//   - stop after a random number of steps,
//   - stop-loss: cash out once the cash-out falls below a random share of the stake,
//   - take-profit: cash out once it climbs above a random multiple of the stake.
// The walker has no choices to make: the only decision is when to stop.
export default defineEval<{ steps: Steps; home: Home }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.steps} steps, home ${HOME_LABEL[p.home]})`,
    params: p,
  })),
  playRound({ steps, home }, rng) {
    const prize = prizeFor(steps, home);
    const mode = rng.next();
    const stopAfter = mode < 0.3 ? steps : mode < 0.55 ? 1 + rng.int(steps) : steps;
    const floor = mode >= 0.55 && mode < 0.78 ? RTP * (0.15 + 0.6 * rng.next()) : 0;
    const target = mode >= 0.78 ? RTP * (1.1 + 2.5 * rng.next()) : Infinity;

    let p: Pt = { x: 0, y: 0 };
    for (let taken = 1; ; taken++) {
      p = stepFrom(p, rng.next() * 2 * Math.PI);
      const left = steps - taken;
      const r = dist(p);
      const end = verdict(left, r, home);
      if (end) return { multiplier: end === 'home' ? prize : 0, steps: taken };
      const cash = prize * homeChance(left, r, home);
      if (taken >= stopAfter || cash < floor || cash >= target) return { multiplier: cash, steps: taken };
    }
  },
});
