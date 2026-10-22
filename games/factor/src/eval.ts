import { defineEval } from '@originals/game-sdk';
import { MIN_N, PAUSES, RANGE, VOLATILITY, baseChance, betLabel, decided, odds, pausesAfter, prize, startTrial, step, type Bet } from './math';

// Each round draws N, a pause setting (every test, each new factor, or never)
// and one of five player habits, then plays the division tests exactly as the
// game does: play to the end, cash out at a random checkpoint, cut losses
// once the chance falls under a share of where it started, lock in once it
// has risen enough, or take profit at a random cash-out multiple.
export default defineEval<{ bet: Bet }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${betLabel(p.bet)}, ${(baseChance(p.bet) * 100).toFixed(2)}%)`,
    params: p,
  })),
  playRound({ bet }, rng) {
    const n = MIN_N + rng.int(RANGE);
    const pause = PAUSES[rng.int(PAUSES.length)];
    const base = baseChance(bet);
    const full = prize(bet);
    const habit = rng.int(5);
    const stopAt = 1 + rng.int(8);
    const cutBelow = base * (0.2 + 0.7 * rng.next());
    const lockAbove = Math.min(0.97, base * (1.3 + 3 * rng.next()));
    const takeAt = 1.1 + 4 * rng.next();

    let t = startTrial();
    let checkpoints = 0;
    for (;;) {
      const before = t;
      t = step(t, n);
      const o = odds(t, bet);
      if (decided(o)) return { multiplier: o.win ? full : 0, steps: t.tests };
      if (!pausesAfter(pause, before, t)) continue;
      checkpoints++;
      const cash = full * o.chance;
      const stop =
        (habit === 1 && checkpoints >= stopAt) ||
        (habit === 2 && o.chance < cutBelow) ||
        (habit === 3 && o.chance > lockAbove) ||
        (habit === 4 && cash >= takeAt);
      if (stop) return { multiplier: cash, steps: t.tests };
    }
  },
});
