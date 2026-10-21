import { defineEval } from '@originals/game-sdk';
import { BURSTS, VOLATILITY_NAMES, VOLATILITY_START, cashMultiplier, endingAt, prizeMultiplier, step, type AutoRules } from './math';

// Track length per level: mixes short and long tracks while keeping the
// walk (x0·(W−x0) steps on average when held) quick to simulate.
const TRACK_FOR = { low: 20, medium: 40, high: 20, extreme: 100 } as const;

// Each round the simulated player samples a stopping rule: a burst size, an
// optional take-profit and stop-loss, an optional "cash out at checkpoint n",
// and sometimes "cash out the first time a checkpoint is lower than the last".
export default defineEval<{ W: number; x0: number }>({
  configs: VOLATILITY_NAMES.map((v) => {
    const W = TRACK_FOR[v];
    const x0 = VOLATILITY_START[v] * W;
    return { label: `${v} (start ${x0}/${W}, ${prizeMultiplier(W, x0).toFixed(2)}×)`, params: { W, x0 } };
  }),
  playRound({ W, x0 }, rng) {
    const burst = BURSTS[rng.int(BURSTS.length)] || Infinity;
    const rules: AutoRules = {
      takeProfit: rng.next() < 0.5 ? x0 + 1 + rng.int(W - x0) : null,
      stopLoss: rng.next() < 0.5 ? rng.int(x0) : null,
    };
    const cashAt = rng.next() < 0.5 ? 1 + rng.int(20) : Infinity;
    const cutOnDip = rng.next() < 0.25;

    let x = x0;
    let last = x0;
    let steps = 0;
    let checkpoints = 0;
    for (;;) {
      x = step(x, rng);
      steps++;
      if (endingAt(x, W, rules)) break;
      if (steps % burst === 0) {
        checkpoints++;
        if (checkpoints >= cashAt || (cutOnDip && x < last)) break;
        last = x;
      }
    }
    return { multiplier: cashMultiplier(x, x0), steps };
  },
});
