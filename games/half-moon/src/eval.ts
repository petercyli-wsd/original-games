import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterSafeDrop, danger, fits, type Target, type Window } from './math';

// Each round the simulated player picks a random number of points to stop
// at (sometimes holding to the full board), so the eval covers every
// fixed-stop strategy, and some rounds stop as soon as a drop gets risky.
export default defineEval<{ window: Window; target: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.window}°, ${p.target} points)`, params: p })),
  playRound({ window, target }, rng) {
    const stopAt = rng.next() < 0.3 ? target : 1 + rng.int(target);
    const riskCap = rng.next() < 0.25 ? 0.2 + rng.next() * 0.4 : 1;
    const points = [rng.next()];
    let cash = RTP;
    while (points.length < stopAt) {
      const { q } = danger(points, window);
      if (q > riskCap) break;
      const p = rng.next();
      points.push(p);
      if (!fits(points, window)) return { multiplier: 0, steps: points.length };
      cash = afterSafeDrop(cash, q);
    }
    return { multiplier: cash, steps: points.length };
  },
});
