import { defineEval } from '@originals/game-sdk';
import { DEFAULT_CONFIG } from './config';
import { initialState, reducer, type GameState } from './game';
import { BITE, buildLadder, pickTraps } from './math';

interface Params {
  k: number;
}

// One knob: bad teeth on the fixed 20-tooth jaw.
const LEVELS: [string, number][] = [
  ['low', 1],
  ['medium', 4],
  ['high', 12],
  ['extreme', 19],
];

// Plays real rounds through the game reducer. The simulated player presses
// random teeth and stops in one of three ways: after a random number of
// rounds, as soon as the next press is too risky for them, or never (play to
// the end).
export default defineEval<Params>({
  configs: LEVELS.map(([level, k]) => ({ label: `${level} (${k} bad of ${DEFAULT_CONFIG.teeth})`, params: { k } })),
  playRound({ k }, rng) {
    const N = DEFAULT_CONFIG.teeth;
    const rtp = DEFAULT_CONFIG.rtp;
    const rounds = buildLadder(N, k, BITE, rtp).length;
    const style = rng.next();
    const cashAfter = style < 0.3 ? Infinity : 1 + rng.int(rounds);
    const riskCap = style > 0.75 ? 0.15 + rng.next() * 0.45 : 1;
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N, k, rtp, traps: pickTraps(N, k, rng) });
    let steps = 0;
    while (s.phase === 'you' || s.phase === 'house') {
      const rd = s.round!;
      if (s.phase === 'you' && rd.r > 0) {
        const left = rd.pressed.filter((p) => !p).length;
        if (rd.r >= cashAfter || k / left > riskCap) {
          s = reducer(s, { type: 'cashOut' });
          continue;
        }
      }
      const free = rd.pressed.flatMap((p, i) => (p ? [] : [i]));
      if (s.phase === 'you') steps++;
      s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i: free[rng.int(free.length)] });
    }
    return { multiplier: s.history[0].mult, steps };
  },
});
