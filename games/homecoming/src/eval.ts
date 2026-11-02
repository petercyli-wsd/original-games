import { defineEval } from '@originals/game-sdk';
import { BUDGET, RTP, VOLATILITY, origin, prizeFor, sideChance, walkStep, type Settings } from './math';

// Each simulated player follows one of five stopping rules, sampled per
// round, so the eval covers very different strategies:
//   - walk to the end,
//   - stop after a random number of steps,
//   - stop-loss: cash out once the cash-out falls below a random share of the stake,
//   - take-profit: cash out once it climbs above a random multiple of the stake,
//   - risk threshold: cash out once the backed side's chance drops below a random level.
// The side (Home or Away) is part of each config; both are priced at their own odds.
// `steps` counts presses of Step: every press is one step and a checkpoint.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.dim}D, back ${s.side === 'home' ? 'Home' : 'Away'})`,
    params: s,
  })),
  playRound(s, rng) {
    const mode = rng.next();
    const stopAfter = mode < 0.25 ? BUDGET : mode < 0.45 ? 1 + rng.int(BUDGET) : BUDGET;
    const floor = mode >= 0.45 && mode < 0.65 ? RTP * (0.15 + 0.6 * rng.next()) : 0;
    const target = mode >= 0.65 && mode < 0.85 ? RTP * (1.1 + 2 * rng.next()) : Infinity;
    const minChance = mode >= 0.85 ? 0.05 + 0.4 * rng.next() : 0;
    const prize = prizeFor(s);

    let pos = origin(s.dim);
    let left = BUDGET;
    for (let n = 1; ; n++) {
      const st = walkStep(s, pos, left, rng.next());
      if (st.verdict) return { multiplier: st.verdict === 'won' ? prize : 0, steps: n };
      pos = st.to;
      left--;
      if (n >= stopAfter || st.cash < floor || st.cash >= target || sideChance(s.side, s.dim, pos, left) < minChance)
        return { multiplier: st.cash, steps: n };
    }
  },
});
