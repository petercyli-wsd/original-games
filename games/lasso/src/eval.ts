import { defineEval } from '@originals/game-sdk';
import { BURST, FIELD_LABEL, START, VOLATILITY, prizeFor, walk, type Settings } from './math';

// Each simulated player follows one of four stopping rules, sampled per
// round, so the eval covers very different strategies:
//   - walk to the end,
//   - stop at a random checkpoint,
//   - stop-loss: cash out once the cash-out falls below a random share of the stake,
//   - take-profit: cash out once it climbs above a random multiple of the stake.
// Steps counted are checkpoints (bursts of BURST steps), the player's decisions.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${FIELD_LABEL[s.field]}, ${s.steps} steps, ${s.laps} loop${s.laps > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const prize = prizeFor(s);
    const bursts = Math.ceil(s.steps / BURST);
    const mode = rng.next();
    const stopAfter = mode < 0.3 ? bursts : mode < 0.55 ? 1 + rng.int(bursts) : bursts;
    const floor = mode >= 0.55 && mode < 0.78 ? 0.99 * (0.1 + 0.6 * rng.next()) : 0;
    const target = mode >= 0.78 ? 0.99 * (1.2 + 3 * rng.next()) : Infinity;

    let at = START;
    let w = 0;
    let left: number = s.steps;
    for (let b = 1; ; b++) {
      const r = walk(s, at, w, left, BURST, () => rng.next());
      at = r.cells.length ? r.cells[r.cells.length - 1] : at;
      w = r.w;
      left = r.left;
      const cash = prize * r.p;
      if (r.p === 0 || r.p === 1 || left === 0) return { multiplier: cash, steps: b };
      if (b >= stopAfter || cash < floor || cash >= target) return { multiplier: cash, steps: b };
    }
  },
});
