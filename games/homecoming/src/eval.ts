import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, burstOf, origin, prizeFor, walkBurst, type Settings } from './math';

// Each simulated player follows one of four stopping rules, sampled per
// round, so the eval covers very different strategies:
//   - walk to the end,
//   - stop after a random number of presses,
//   - stop-loss: cash out once the cash-out falls below a random share of the stake,
//   - take-profit: cash out once it climbs above a random multiple of the stake.
// The side (Home or Away) is part of each config; both are priced at their own odds.
// `steps` counts presses (checkpoints): one free first step, then bursts of budget/10 steps.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.dim}D, ${s.budget} steps, back ${s.side === 'home' ? 'Home' : 'Away'})`,
    params: s,
  })),
  playRound(s, rng) {
    const presses = 1 + Math.ceil((s.budget - 1) / burstOf(s.budget));
    const mode = rng.next();
    const stopAfter = mode < 0.3 ? presses : mode < 0.55 ? 1 + rng.int(presses) : presses;
    const floor = mode >= 0.55 && mode < 0.78 ? RTP * (0.15 + 0.6 * rng.next()) : 0;
    const target = mode >= 0.78 ? RTP * (1.1 + 2 * rng.next()) : Infinity;
    const prize = prizeFor(s);

    let pos = origin(s.dim);
    let left = s.budget;
    for (let n = 1; ; n++) {
      const b = walkBurst(s, pos, left, () => rng.next());
      if (b.verdict) return { multiplier: b.verdict === 'won' ? prize : 0, steps: n };
      pos = b.path[b.path.length - 1];
      left -= b.path.length;
      if (n >= stopAfter || b.cash < floor || b.cash >= target) return { multiplier: b.cash, steps: n };
    }
  },
});
