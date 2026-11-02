import { defineEval } from '@originals/game-sdk';
import { BLOCKS, SIZES, VOLATILITY, blockName, cashValue, columns, newRound, nextLoss, plan, prizeFor, startChance, winChance } from './math';

type Strategy = 'end' | 'count' | 'risk' | 'profit';

// Each round samples a player: play to the end, stop after a random number of
// joins, stop when the next join is too likely to end the round (or the win
// chance sinks), or take a profit target.
export default defineEval<{ block: number }>({
  configs: Object.entries(VOLATILITY).map(([level, block]) => ({
    label: `${level} (back ${blockName(block)}, size ${SIZES[block]})`,
    params: { block },
  })),
  playRound({ block }, rng) {
    const prize = prizeFor(block);
    const u = rng.next();
    const strategy: Strategy = u < 0.3 ? 'end' : u < 0.6 ? 'count' : u < 0.8 ? 'risk' : 'profit';
    const stopAfter = 1 + rng.int(BLOCKS);
    const maxLoss = 0.15 + 0.6 * rng.next();
    const floor = (0.2 + 0.7 * rng.next()) * startChance(block);
    const target = 1 + rng.next() * (prize - 1) * 0.8;

    let r = newRound(block);
    for (let actions = 1; ; actions++) {
      const joins = plan(r, rng);
      r = joins[joins.length - 1];
      if (r.status !== 'live') return { multiplier: r.status === 'won' ? prize : 0, steps: r.order.length };
      const cash = cashValue(r);
      const stop =
        (strategy === 'count' && actions >= stopAfter) ||
        (strategy === 'risk' && (nextLoss(columns(r)) >= maxLoss || winChance(r) < floor)) ||
        (strategy === 'profit' && cash >= target);
      if (stop) return { multiplier: cash, steps: r.order.length };
    }
  },
});
