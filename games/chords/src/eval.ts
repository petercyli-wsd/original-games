import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterClearChord, afterFirstEnd, clearChance, faces, isClear, signature, type Chord, type Target } from './math';

// Each simulated round samples a pace (pause after every end, or only between
// chords) and one of several stopping strategies, so the eval covers every
// kind of play:
//   - play to the end (the board auto-cashes when full);
//   - stop at a random checkpoint;
//   - a risk threshold: stop when the next chord, or the second end, is less
//     likely than a random cap to land clear;
//   - an impulsive player who cashes at each checkpoint with some chance.
// Steps count reveals: the free first chord is one, then each end is one.
export default defineEval<{ target: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.target} chords)`, params: p })),
  playRound({ target }, rng) {
    const byEnd = rng.next() < 0.5;
    const mode = rng.next();
    const checkpoints = byEnd ? 2 * (target - 1) : target - 1;
    const stopAt = mode >= 0.3 && mode < 0.55 ? 1 + rng.int(checkpoints) : Infinity;
    const cap = mode >= 0.55 && mode < 0.8 ? 0.15 + rng.next() * 0.5 : 0;
    const impulse = mode >= 0.8 ? 0.1 + rng.next() * 0.3 : 0;
    let seen = 0;
    // At a checkpoint: does this player cash out here?
    const stop = (chance: number) => ++seen >= stopAt || chance < cap || (impulse > 0 && rng.next() < impulse);

    // The first chord is free: one region, Σ L² = 1.
    let chords: Chord[] = [{ a: rng.next(), b: rng.next() }];
    let cash = RTP;
    let steps = 1;
    while (chords.length < target) {
      const shares = faces(chords);
      const S = clearChance(shares);
      if (stop(S)) break;

      const x = rng.next();
      const home = signature(chords, x);
      const L = (shares.find((f) => f.sig === home) ?? shares[0]).length;
      const base = cash;
      cash = afterFirstEnd(base, S, L);
      steps++;
      if (byEnd && stop(L)) break;

      const y = rng.next();
      steps++;
      if (!isClear(chords, x, y)) return { multiplier: 0, steps };
      cash = afterClearChord(base, S);
      chords = [...chords, { a: x, b: y }];
    }
    return { multiplier: cash, steps };
  },
});
