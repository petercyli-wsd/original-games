import { defineEval } from '@originals/game-sdk';
import { FACTORS, RTP, VOLATILITY, digitList, prizeFor, startChance, winChance, type DigitSet, type Length } from './math';

// The simulated player samples a strategy each round:
//  - 30% play every factor to the end;
//  - 30% cash out after a random number of factors (1…k);
//  - 25% risk threshold: cash out as soon as the live win chance falls below
//    a random share (25–95%) of the starting chance;
//  - 15% take profit: cash out once the cash-out reaches a random 1.2–5× of
//    the stake.
// The game's own stopping rules (out of reach at P = 0, locked in at P = 1)
// apply to every strategy, exactly as in the UI. The round has no in-round
// choices (digits and length are fixed at the bet), so none are sampled.
export default defineEval<{ digits: DigitSet; factors: Length }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (leads with ${digitList(p.digits)}, ${p.factors} factors)`,
    params: p,
  })),
  playRound({ digits, factors }, rng) {
    const prize = prizeFor(digits, factors);
    const p0 = startChance(digits, factors);
    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.6 ? 1 + rng.int(factors) : factors;
    const chanceFloor = style >= 0.6 && style < 0.85 ? p0 * (0.25 + rng.next() * 0.7) : 0;
    const takeProfit = style >= 0.85 ? 1.2 + rng.next() * 3.8 : Infinity;

    let product = 1;
    let left: number = factors;
    let p = p0;
    let cash = RTP;
    let steps = 0;
    while (left > 0) {
      // The player can only stop at a checkpoint, after at least one factor.
      if (steps > 0 && (steps >= stopAfter || p < chanceFloor || cash >= takeProfit)) break;
      product *= FACTORS[rng.int(FACTORS.length)];
      left--;
      steps++;
      p = winChance(product, left, digits);
      if (p === 0) return { multiplier: 0, steps };
      if (p === 1) return { multiplier: prize, steps };
      cash = prize * p;
    }
    return { multiplier: cash, steps };
  },
});
