import { defineEval } from '@originals/game-sdk';
import { COMMITTEES, VOLATILITY, cashValue, columns, newRound, nextLoss, plan, prizeFor, shapley, voterName, winChance, type CommitteeId } from './math';

type Strategy = 'end' | 'count' | 'risk' | 'profit';

// Each round samples a player: play to the end, stop after a random number of
// joins, stop when the next join is too likely to end the round (or the win
// chance sinks), or take a profit target.
export default defineEval<{ committee: CommitteeId; voter: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${COMMITTEES[p.committee].name}, back ${voterName(p.voter)}·${COMMITTEES[p.committee].weights[p.voter]})`,
    params: p,
  })),
  playRound({ committee, voter }, rng) {
    const prize = prizeFor(committee, voter);
    const u = rng.next();
    const strategy: Strategy = u < 0.3 ? 'end' : u < 0.6 ? 'count' : u < 0.8 ? 'risk' : 'profit';
    const stopAfter = 1 + rng.int(COMMITTEES[committee].weights.length);
    const maxLoss = 0.15 + 0.6 * rng.next();
    const floor = (0.2 + 0.7 * rng.next()) * shapley(committee, voter);
    const target = 1 + rng.next() * (prize - 1) * 0.8;

    let r = newRound(committee, voter);
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
