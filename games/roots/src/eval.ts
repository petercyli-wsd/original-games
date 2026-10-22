import { defineEval } from '@originals/game-sdk';
import { HIDDEN, SIDE_LABEL, VOLATILITY, cashOut, draw, pWin, prize, stageOf, type Coeffs, type Range, type Side } from './math';

// Each round the simulated player follows one sampled behaviour:
//   - play to the end (reveal a, c and b);
//   - stop after a random number of reveals (1, 2 or all 3);
//   - a risk threshold: cash out as soon as the chance falls below a floor
//     (cut losses) or rises above a ceiling (lock in), else play on.
// Bet always reveals a. A reveal that makes the result certain ends the round.
export default defineEval<{ side: Side; range: Range }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${SIDE_LABEL[p.side].toLowerCase()}, b on ±${p.range})`,
    params: p,
  })),
  playRound({ side, range }, rng) {
    const p0 = pWin(side, HIDDEN, range);
    const mode = rng.next();
    const stopAfter = mode < 0.3 ? 3 : mode < 0.65 ? 1 + rng.int(3) : 3;
    const threshold = mode >= 0.65;
    const floor = threshold ? p0 * rng.next() : 0;
    const ceiling = threshold ? p0 + (1 - p0) * rng.next() : 1;

    const k: Coeffs = { ...HIDDEN };
    let steps = 0;
    for (;;) {
      const stage = stageOf(k);
      if (stage === 0) k.a = draw(rng.next(), 1);
      else if (stage === 1) k.c = draw(rng.next(), 1);
      else k.b = draw(rng.next(), range);
      steps++;

      const p = pWin(side, k, range);
      if (p === 0) return { multiplier: 0, steps };
      if (p === 1) return { multiplier: prize(side, range), steps };
      if (steps >= stopAfter || p < floor || p > ceiling) return { multiplier: cashOut(side, k, range), steps };
    }
  },
});
