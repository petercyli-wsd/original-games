import { defineEval } from '@originals/game-sdk';
import { N, VOLATILITY, cashValue, decided, newDeal, newPileCards, place, prizeFor, startChance, winChance } from './math';

// The simulated player mixes strategies, so the eval covers many stopping
// rules: play every card, stop after a random number of cards, take profit or
// cut losses at a win-chance threshold, or stop when too many of the cards
// left would open a new pile. Once the result is certain the round settles at
// 0 or the prize (the rest is only dealt for show).
export default defineEval<number>({
  configs: Object.entries(VOLATILITY).map(([level, k]) => ({
    label: `${level} (${N} cards, at most ${k} piles)`,
    params: k,
  })),
  playRound(k, rng) {
    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.6 ? 1 + rng.int(N) : Infinity;
    const thresholds = style >= 0.6 && style < 0.75;
    const takeProfit = thresholds ? 0.4 + rng.next() * 0.58 : 2;
    const cutLoss = thresholds ? rng.next() * 0.3 * startChance(k) : -1;
    const dangerCap = style >= 0.75 ? 0.05 + rng.next() * 0.6 : 2;

    let d = newDeal();
    let steps = 0;
    for (;;) {
      const card = d.remaining[rng.int(d.remaining.length)];
      d = place(d, card);
      steps++;
      const result = decided(k, d);
      if (result) return { multiplier: result === 'won' ? prizeFor(k) : 0, steps };
      if (steps >= stopAfter) break;
      const p = winChance(k, d);
      if (p >= takeProfit || p <= cutLoss) break;
      if (newPileCards(d).length / d.remaining.length > dangerCap) break;
    }
    return { multiplier: cashValue(k, d), steps };
  },
});
