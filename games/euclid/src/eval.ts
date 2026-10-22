import { defineEval } from '@originals/game-sdk';
import { NO_CLUES, VOLATILITY, drawPair, odds, prize, reveal, type Bet, type Clues, type Size } from './math';

const BET_NAME = (bet: Bet) => (bet.kind === 'coprime' ? 'coprime' : bet.kind === 'square' ? 'square ≥ 2' : `≥ ${bet.cuts} cuts`);

// The simulated player mixes strategies: play every round to the end, stop
// after a random number of cuts, or stop once the live chance drops below (or
// the cash-out climbs above) a random threshold. The bet itself makes the
// first cut, so every round has at least one step.
export default defineEval<{ size: Size; bet: Bet }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (N = ${p.size}, ${BET_NAME(p.bet)})`, params: p })),
  playRound({ size, bet }, rng) {
    const pair = drawPair(size, (n) => rng.int(n));
    const full = prize(size, bet);
    const r = rng.next();
    const stopAfter = r < 0.35 ? Infinity : r < 0.7 ? 1 + rng.int(6) : Infinity;
    const minChance = r >= 0.7 && rng.next() < 0.5 ? 0.1 + 0.5 * rng.next() : 0;
    const takeAt = r >= 0.7 && minChance === 0 ? 1.2 + 3 * rng.next() : Infinity;
    let clues: Clues = NO_CLUES;
    for (let steps = 1; ; steps++) {
      clues = reveal(pair, clues)!;
      const o = odds(size, bet, clues);
      if (o.wins === 0) return { multiplier: 0, steps };
      if (o.wins === o.total) return { multiplier: full, steps };
      const cash = full * o.p;
      if (steps >= stopAfter || o.p < minChance || cash >= takeAt) return { multiplier: cash, steps };
    }
  },
});
