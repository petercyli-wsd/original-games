import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterSafeDrop, core, hitsCap, meets, risk, type Interval, type Target } from './math';

// The simulated player mixes strategies round by round:
//   - play to the end,
//   - stop after a random number of intervals,
//   - stop once the next drop is too risky (a random safety threshold),
//   - stop once the cash-out reaches a goal.
// The game's own max-win auto-cash applies to all of them. The only choice is
// when to stop, and one RTP holds for every mix because the cash-out is a
// martingale.
export default defineEval<{ target: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.target} intervals)`, params: p })),
  playRound({ target }, rng) {
    const mode = rng.next();
    const stopAt = mode < 0.3 ? target : 1 + rng.int(target);
    const minSafe = mode >= 0.55 && mode < 0.8 ? 0.2 + rng.next() * 0.6 : 0;
    const goal = mode >= 0.8 ? 1.2 + rng.next() * 30 : Infinity;

    const intervals: Interval[] = [];
    let cash = RTP;
    while (intervals.length < stopAt && cash < goal) {
      const c = core(intervals);
      const q = risk(c);
      if (intervals.length > 0 && (hitsCap(cash, q) || 1 - q < minSafe)) break;
      const iv = { u: rng.next(), v: rng.next() };
      if (!meets(c, iv)) return { multiplier: 0, steps: intervals.length + 1 };
      intervals.push(iv);
      cash = afterSafeDrop(cash, q);
    }
    return { multiplier: cash, steps: intervals.length };
  },
});
