import { defineEval } from '@originals/game-sdk';
import { CUT_OPTIONS, MODE_NAMES, cashMultiplier, cutRound, newRound, sampleCut, type Mode } from './math';

// The simulated player places its circle anywhere, picks a pace (number of
// cuts) and a random checkpoint to cash out at (the last one means riding to
// the reveal), so the eval covers every strategy at once.
export default defineEval<{ mode: Mode }>({
  configs: MODE_NAMES.map((mode) => ({ label: mode, params: { mode } })),
  playRound({ mode }, rng) {
    const maxCuts = CUT_OPTIONS[rng.int(CUT_OPTIONS.length)];
    const stopAt = 1 + rng.int(maxCuts);
    let round = newRound(mode, { x: rng.next(), y: rng.next() }, maxCuts, { x: rng.next(), y: rng.next() });
    while (round.outcome === 'live' && round.slices.length < stopAt) round = cutRound(round, sampleCut(round.region, rng));
    return { multiplier: cashMultiplier(round), steps: round.slices.length };
  },
});
