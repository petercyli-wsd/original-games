import { defineEval } from '@originals/game-sdk';
import { initialState, reducer, type GameState } from './game';
import { RTP } from './manifest';
import { pickTraps } from './math';

interface Params {
  N: number;
  k: number;
}

// The calmest board, the default, a mid-risk one, and the wildest (which
// holds the top multiplier).
const BOARDS: Params[] = [
  { N: 20, k: 1 },
  { N: 12, k: 1 },
  { N: 10, k: 3 },
  { N: 20, k: 5 },
];

// Plays real rounds through the reducer. The simulated player picks a random
// number of safe presses to stop after (up to all of them) and presses random teeth.
export default defineEval<Params>({
  configs: BOARDS.map((p) => ({ label: `${p.N} teeth, ${p.k} bad`, params: p })),
  playRound({ N, k }, rng) {
    const cashAfter = 1 + rng.int(N - k);
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N, k, rtp: RTP, traps: pickTraps(N, k, rng) });
    let steps = 0;
    while (s.phase === 'playing') {
      if (s.round!.safe >= cashAfter) {
        s = reducer(s, { type: 'cashOut' });
        break;
      }
      const free = s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
      steps++;
      s = reducer(s, { type: 'press', i: free[rng.int(free.length)] });
    }
    return { multiplier: s.history[0].mult, steps };
  },
});
