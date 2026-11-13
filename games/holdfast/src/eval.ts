import { defineEval } from '@originals/game-sdk';
import { playRound } from './math';

// One config: the game has no settings. A round is the paid spin plus every free spin
// and lock it leads to, drawn exactly as the game draws it.
export default defineEval<Record<string, never>>({
  configs: [{ label: 'high (40 lines, one setting)', params: {} }],
  playRound(_params, rng) {
    const r = playRound(rng);
    return { multiplier: r.multiplier, steps: r.spins };
  },
});
