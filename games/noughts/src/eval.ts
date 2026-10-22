import { defineEval } from '@originals/game-sdk';
import { SIDE_NAME, VOLATILITY, cashValue, newSeries, nextLoss, plan, prizeFor, startChance, winChance, type Games, type Mode, type Side } from './math';

type Strategy = 'end' | 'count' | 'risk' | 'profit' | 'between';

// Each round samples a player: play every game out, stop after a random
// number of actions, stop when the next mark is too likely to lose (or the
// win chance sinks), take a profit target, or stop between games. Actions
// themselves are random too: one mark, or "play the game out".
export default defineEval<{ side: Side; games: Games }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${SIDE_NAME[p.side]}, ${p.games} game${p.games > 1 ? 's' : ''})`,
    params: p,
  })),
  playRound({ side, games }, rng) {
    const prize = prizeFor(side, games);
    const u = rng.next();
    const strategy: Strategy = u < 0.25 ? 'end' : u < 0.5 ? 'count' : u < 0.7 ? 'risk' : u < 0.85 ? 'profit' : 'between';
    const stopAfter = 1 + rng.int(5 * games);
    const maxLoss = 0.15 + 0.6 * rng.next();
    const floor = (0.2 + 0.7 * rng.next()) * startChance(side, games);
    const target = 1 + rng.next() * (prize - 1) * 0.8;
    const autoShare = strategy === 'end' ? 0.5 : 0.15;

    let s = newSeries(side, games);
    let steps = 0;
    for (let actions = 1; ; actions++) {
      const mode: Mode = rng.next() < autoShare ? 'game' : 'move';
      const moves = plan(s, mode, rng);
      steps += moves.length;
      const ended = moves[moves.length - 1].ended !== null;
      s = moves[moves.length - 1].next;
      if (s.status !== 'live') return { multiplier: s.status === 'won' ? prize : 0, steps };

      const cash = cashValue(s);
      const stop =
        (strategy === 'count' && actions >= stopAfter) ||
        (strategy === 'risk' && (nextLoss(s) >= maxLoss || winChance(s) < floor)) ||
        (strategy === 'profit' && cash >= target) ||
        (strategy === 'between' && ended && rng.next() < 0.6);
      if (stop) return { multiplier: cash, steps };
    }
  },
});
