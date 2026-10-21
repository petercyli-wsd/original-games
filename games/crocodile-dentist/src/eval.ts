import { defineEval } from '@originals/game-sdk';
import { DEFAULT_CONFIG } from './config';
import { initialState, reducer, type GameState } from './game';
import { buildLadder, pickTraps } from './math';

interface Params {
  N: number;
  k: number;
  J: number;
}

// The calmest and default boards, the pure 50/50 duel, and the wildest boards
// (20 teeth / 5 bad / bite 1× holds the top multiplier).
const BOARDS: Params[] = [
  { N: 20, k: 1, J: 1 },
  { N: 12, k: 1, J: 1.5 },
  { N: 12, k: 1, J: 2 },
  { N: 8, k: 3, J: 1 },
  { N: 20, k: 5, J: 2 },
  { N: 20, k: 5, J: 1 },
];

// Plays real rounds through the game reducer. The simulated player picks a
// random cash-out round (or plays to the end) and presses random teeth.
export default defineEval<Params>({
  configs: BOARDS.map((p) => ({ label: `${p.N} teeth, ${p.k} bad, bite ${p.J}×`, params: p })),
  playRound({ N, k, J }, rng) {
    const rtp = DEFAULT_CONFIG.rtp;
    const cashAfter = 1 + rng.int(buildLadder(N, k, J, rtp).length + 1);
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N, k, J, rtp, traps: pickTraps(N, k, rng) });
    let steps = 0;
    while (s.phase === 'you' || s.phase === 'house') {
      if (s.phase === 'you' && s.round!.r >= cashAfter) {
        s = reducer(s, { type: 'cashOut' });
        continue;
      }
      const free = s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
      if (s.phase === 'you') steps++;
      s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i: free[rng.int(free.length)] });
    }
    return { multiplier: s.history[0].mult, steps };
  },
});
