import { defineEval } from '@originals/game-sdk';
import { MODES, MODE_NAMES, multiplierAt, type Mode } from './math';

// The simulated player picks a random cash-out step each round, so the eval
// covers every strategy at once.
export default defineEval<{ mode: Mode }>({
  configs: MODE_NAMES.map((mode) => ({ label: mode, params: { mode } })),
  playRound({ mode }, rng) {
    const { p, maxSteps } = MODES[mode];
    const target = 1 + rng.int(maxSteps);
    for (let steps = 0; steps < target; steps++) {
      if (rng.next() >= p) return { multiplier: 0, steps: steps + 1 };
    }
    return { multiplier: multiplierAt(mode, target), steps: target };
  },
});
