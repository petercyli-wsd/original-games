import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, autoStop, centre, freeCount, step, type Dir, type Grid, type Target } from './math';

// The simulated player mixes strategies round by round:
//   - play to the end (the "All" auto-step),
//   - stop at a random length,
//   - stop once the next step is too risky (the ≥75% / ≥50% auto-step rules,
//     plus a random free-direction threshold),
//   - stop once the cash-out reaches a random goal.
// The game's own forced stops (target reached, trapped) apply to all of them.
// Directions are drawn uniformly, exactly as in the game; there are no other
// player choices. One RTP holds for every mix: the cash-out is a martingale.
export default defineEval<{ grid: Grid; target: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.grid}×${p.grid}, length ${p.target})`, params: p })),
  playRound({ grid, target }, rng) {
    const mode = rng.next();
    const stopAt = mode < 0.3 ? target : 2 + rng.int(target - 1);
    const minFree = mode >= 0.55 && mode < 0.8 ? [3, 2, 1 + rng.int(3)][rng.int(3)] : 0;
    const goal = mode >= 0.8 ? 1.2 + rng.next() * 40 : Infinity;

    let path = [centre(grid)];
    let cash = RTP;
    let steps = 0;
    while (!autoStop(grid, target, path)) {
      // The bet always makes the first (free) step; the player decides from length 2 on.
      if (path.length > 1 && (path.length >= stopAt || cash >= goal || freeCount(grid, path) < minFree)) break;
      const r = step(grid, path, cash, rng.int(4) as Dir);
      steps++;
      if (!r.safe) return { multiplier: 0, steps };
      path = r.path;
      cash = r.cash;
    }
    return { multiplier: cash, steps };
  },
});
