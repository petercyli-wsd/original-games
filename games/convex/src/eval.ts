import { defineEval } from '@originals/game-sdk';
import { FREE_DROPS, RTP, VOLATILITY, afterSafeDrop, hitsCap, landsSafe, samplePoint, zones, type Arena, type Pt, type Target } from './math';

// The simulated player mixes strategies round by round:
//   - play to the end (the "All" auto-drop),
//   - stop after a random number of corners,
//   - stop once the next drop is too risky (the ≥ 90% / ≥ 75% auto-drop rules are this, with other thresholds too),
//   - stop once the cash-out reaches a goal.
// The game's own max-win auto-cash applies to all of them. The game has no
// player choices besides when to stop. One RTP holds for every mix, because
// the cash-out is a martingale.
export default defineEval<{ arena: Arena; target: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.arena}, ${p.target} corners)`, params: p })),
  playRound({ arena, target }, rng) {
    const mode = rng.next();
    const stopAt = mode < 0.3 ? target : FREE_DROPS + rng.int(target - FREE_DROPS + 1);
    const minSafe = mode >= 0.55 && mode < 0.8 ? [0.9, 0.75, rng.next()][rng.int(3)] : 0;
    const goal = mode >= 0.8 ? 1.2 + rng.next() * 30 : Infinity;

    const points: Pt[] = [];
    while (points.length < FREE_DROPS) points.push(samplePoint(arena, rng.next));
    let cash = RTP;
    while (points.length < stopAt && cash < goal) {
      const { hull, q } = zones(points, arena);
      if (hitsCap(cash, q) || 1 - q < minSafe) break;
      const p = samplePoint(arena, rng.next);
      if (!landsSafe(hull, p)) return { multiplier: 0, steps: points.length + 1 };
      points.push(p);
      cash = afterSafeDrop(cash, q);
    }
    return { multiplier: cash, steps: points.length };
  },
});
