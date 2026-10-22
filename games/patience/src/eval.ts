import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, cashValue, decided, ghosts, newDeal, place, prizeFor, winChance, type Bet } from './math';

// The simulated player mixes strategies, so the eval covers many stopping
// rules: play every card, stop after a random number of cards, take profit or
// cut losses at a win-chance threshold, or stop when too many of the cards
// left would kill the round. Once the result is certain the round settles at
// 0 or the prize (the rest is only dealt for show).
const describe = (b: Bet) => `${b.n} cards, ${b.mode === 'fit' ? 'at most' : 'at least'} ${b.k} piles`;

export default defineEval<Bet>({
  configs: Object.entries(VOLATILITY).map(([level, bet]) => ({
    label: `${level} (${describe(bet)})`,
    params: bet,
  })),
  playRound(bet, rng) {
    const style = rng.next();
    const stopAfter = style < 0.3 ? Infinity : style < 0.6 ? 1 + rng.int(bet.n) : Infinity;
    const takeProfit = style >= 0.6 && style < 0.75 ? 0.4 + rng.next() * 0.58 : 2;
    const cutLoss = style >= 0.6 && style < 0.75 ? rng.next() * 0.3 * winChance(bet, newDeal(bet.n)) : -1;
    const dangerCap = style >= 0.75 ? 0.05 + rng.next() * 0.5 : 2;

    let d = newDeal(bet.n);
    let steps = 0;
    for (;;) {
      const card = d.remaining[rng.int(d.remaining.length)];
      d = place(d, card);
      steps++;
      const result = decided(bet, d);
      if (result) return { multiplier: result === 'won' ? prizeFor(bet) : 0, steps };
      if (steps >= stopAfter) break;
      const p = winChance(bet, d);
      if (p >= takeProfit || p <= cutLoss) break;
      if (dangerCap < 1) {
        const g = ghosts(bet, d);
        if (g.filter((x) => x.chance === 0).length / g.length > dangerCap) break;
      }
    }
    return { multiplier: cashValue(bet, d), steps };
  },
});
