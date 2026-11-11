import { defineEval } from '@originals/game-sdk';
import { WHEEL, cashOut, prize, startState, step, winChance, type State, type Target } from './math';

// Each round the simulated player stops after a random number of spins,
// sometimes plays to the end, and sometimes stops when the win chance drops
// below a random floor. A round has at most three outs, so it is short.
const LEVELS: { level: string; k: Target }[] = [
  { level: 'low', k: 1 },
  { level: 'medium', k: 2 },
  { level: 'high', k: 4 },
  { level: 'extreme', k: 6 },
];

export default defineEval<{ k: Target }>({
  configs: LEVELS.map(({ level, k }) => ({ label: `${level} (${k} ${k === 1 ? 'run' : 'runs'})`, params: { k } })),
  playRound({ k }, rng) {
    const stopAfter = rng.next() < 0.3 ? Infinity : 1 + rng.int(6);
    const floor = rng.next() < 0.25 ? rng.next() * 0.5 : 0;
    let s: State = startState(k);
    let spins = 0;
    for (;;) {
      const r = step(s, WHEEL[rng.int(WHEEL.length)]);
      spins++;
      if (r.kind === 'out' && r.over) return { multiplier: 0, steps: spins };
      if (r.kind === 'hit' && r.won) return { multiplier: prize(k), steps: spins };
      s = r.state;
      if (spins >= stopAfter || winChance(s) < floor) return { multiplier: cashOut(k, s), steps: spins };
    }
  },
});
