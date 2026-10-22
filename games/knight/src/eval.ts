import { defineEval } from '@originals/game-sdk';
import { MOVES, RTP, START, VOLATILITY, cashAt, prizeFor, squareName, verdict, type Config } from './math';

// Each simulated player follows one of four stopping rules, sampled per round:
//   - play all T moves,
//   - stop after a random number of moves,
//   - stop-loss: cash out once the cash-out falls below a random share of the stake,
//   - take-profit: cash out once it climbs above a random multiple of the stake.
// The target is chosen before the bet, so the only in-round decision is when to stop.
export default defineEval<Config>({
  configs: Object.entries(VOLATILITY).map(([level, c]) => ({
    label: `${level} (${c.turns} moves, ${c.target.region === 'square' ? squareName(c.target.square) : c.target.region === 'corner' ? `${c.target.corner} corner` : c.target.region})`,
    params: c,
  })),
  playRound({ turns, target }, rng) {
    const prize = prizeFor(turns, target);
    const mode = rng.next();
    const stopAfter = mode < 0.5 && mode >= 0.25 ? 1 + rng.int(turns) : turns;
    const floor = mode >= 0.5 && mode < 0.75 ? RTP * (0.1 + 0.7 * rng.next()) : 0;
    const takeAt = mode >= 0.75 ? RTP * (1.1 + 4 * rng.next()) : Infinity;

    let s = START;
    for (let taken = 1; ; taken++) {
      const ms = MOVES[s];
      s = ms[rng.int(ms.length)];
      const left = turns - taken;
      const end = verdict(s, left, target);
      if (end) return { multiplier: end === 'win' ? prize : 0, steps: taken };
      const cash = cashAt(prize, s, left, target);
      if (taken >= stopAfter || cash < floor || cash >= takeAt) return { multiplier: cash, steps: taken };
    }
  },
});
