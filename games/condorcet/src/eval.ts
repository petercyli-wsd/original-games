import { defineEval } from '@originals/game-sdk';
import { PICK_NAME, VOLATILITY, cashValue, newSeries, nextLoss, plan, prizeFor, startChance, winChance, type Elections, type Mode, type Pick, type Voters } from './math';

type Strategy = 'end' | 'count' | 'risk' | 'profit' | 'between';

// Each round samples a player: count every election out, stop after a random
// number of actions, stop when the next ballot is too likely to lose (or the
// win chance sinks), take a profit target, or stop between elections. Each
// action is random too: one ballot, or "count the rest" of this election.
// A step is one action (one checkpoint to the next).
export default defineEval<{ pick: Pick; voters: Voters; elections: Elections }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${PICK_NAME[p.pick]}, ${p.voters} voters, ${p.elections} election${p.elections > 1 ? 's' : ''})`,
    params: p,
  })),
  playRound({ pick, voters, elections }, rng) {
    const prize = prizeFor(pick, voters, elections);
    const u = rng.next();
    const strategy: Strategy = u < 0.25 ? 'end' : u < 0.5 ? 'count' : u < 0.7 ? 'risk' : u < 0.85 ? 'profit' : 'between';
    const stopAfter = 1 + rng.int(6 * elections);
    const maxLoss = 0.1 + 0.5 * rng.next();
    const floor = (0.2 + 0.7 * rng.next()) * startChance(pick, voters, elections);
    const target = 1 + rng.next() * (prize - 1) * 0.8;
    const restShare = strategy === 'end' ? 0.5 : 0.2;

    let s = newSeries(pick, voters, elections);
    for (let steps = 1; ; steps++) {
      const mode: Mode = rng.next() < restShare ? 'rest' : 'one';
      const counts = plan(s, mode, rng);
      const last = counts[counts.length - 1];
      s = last.next;
      if (s.status !== 'live') return { multiplier: s.status === 'won' ? prize : 0, steps };

      const cash = cashValue(s);
      const stop =
        (strategy === 'count' && steps >= stopAfter) ||
        (strategy === 'risk' && (nextLoss(s) >= maxLoss || winChance(s) < floor)) ||
        (strategy === 'profit' && cash >= target) ||
        (strategy === 'between' && last.ended && rng.next() < 0.6);
      if (stop) return { multiplier: cash, steps };
    }
  },
});
