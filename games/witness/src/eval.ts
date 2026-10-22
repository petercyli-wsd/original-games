import { defineEval } from '@originals/game-sdk';
import { BET_LABEL, RANGES, VOLATILITY, chance, drawN, prize, runTest, wins, type Settings } from './math';

// The simulated player samples a strategy each round: play every test and
// reveal N (35%), cash out after a random number of passes (35%), or cash
// out once the live chance leaves a random band around its start (30%:
// a stop-loss below and a take-profit above).
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${BET_LABEL[s.bet]}, ${RANGES[s.range].label}, ${s.tests} test${s.tests > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const pay = prize(s);
    const start = chance(s.range, s.bet, s.tests, 0);
    const n = drawN(s.range, rng);
    const mode = rng.next();
    const stopAfter = mode >= 0.35 && mode < 0.7 ? 1 + rng.int(s.tests) : Infinity;
    const band = mode >= 0.7;
    const low = band ? start * rng.next() : -1;
    const high = band ? start + (1 - start) * rng.next() : 2;
    let steps = 0;
    for (let r = 0; r < s.tests; ) {
      steps++;
      if (!runTest(n, rng).pass) return { multiplier: s.bet === 'composite' ? pay : 0, steps };
      r++;
      const p = chance(s.range, s.bet, s.tests, r);
      if (r >= stopAfter || p < low || p > high) return { multiplier: pay * p, steps };
    }
    steps++;
    return { multiplier: wins(s.bet, n, true) ? pay : 0, steps };
  },
});
