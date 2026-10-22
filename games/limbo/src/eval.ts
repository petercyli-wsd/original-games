import { defineEval } from '@originals/game-sdk';
import { MIN_TARGET, clampTarget, play } from './math';

// One config per volatility band. Each round samples a target log-uniformly
// inside the band (a player nudging the target between bets), so the eval
// covers many targets, not one. Every target returns 99%, so one rtp fits all.
const BANDS = [
  { label: 'low (1.01×–1.75×)', lo: MIN_TARGET, hi: 1.75 },
  { label: 'medium (1.75×–5×)', lo: 1.75, hi: 5 },
  { label: 'high (5×–50×)', lo: 5, hi: 50 },
  { label: 'extreme (50×–1,000×)', lo: 50, hi: 1000 },
];

export default defineEval<{ lo: number; hi: number }>({
  configs: BANDS.map(({ label, lo, hi }) => ({ label, params: { lo, hi } })),
  playRound({ lo, hi }, rng) {
    const target = clampTarget(lo * Math.exp(Math.log(hi / lo) * rng.next()));
    const { multiplier } = play(rng.next, target);
    return { multiplier, steps: 1 };
  },
});
