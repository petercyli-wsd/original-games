import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, clampWin, countLit, presetById, prizeFor, type Depth, type Dir, type Win } from './math';

// Each round samples the player. The window is the config's preset, nudged at
// each edge (the choice: any window with a lit fraction is allowed). Then the
// player plays to the end, stops after a random number of steps, cashes out
// once the live chance falls below a threshold, or takes a profit once the
// cash-out passes a target. The round also ends by itself when the chance
// reaches 0 or 1.
export default defineEval<{ preset: string; depth: Depth }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${presetById(p.preset)!.label}, ${p.depth} steps)`,
    params: p,
  })),
  playRound({ preset, depth }, rng) {
    const base = presetById(preset)!;
    let w: Win = base;
    for (let tries = 0; tries < 20; tries++) {
      const cand = clampWin(base.lo + rng.int(9) - 4, base.hi + rng.int(9) - 4);
      if (countLit([], depth, cand).lit > 0) {
        w = cand;
        break;
      }
    }
    const prize = prizeFor(depth, w);

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(depth) : depth;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.1 + rng.next() * 0.6 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.2 + 3 * rng.next()) : Infinity;

    const path: Dir[] = [];
    for (;;) {
      path.push(rng.next() < 0.5 ? 'L' : 'R');
      const { lit, total } = countLit(path, depth, w);
      const p = lit / total;
      const cash = prize * p;
      if (p === 0 || p === 1) return { multiplier: cash, steps: path.length };
      if (path.length >= stopAfter || p < riskFloor || cash >= profitAt) return { multiplier: cash, steps: path.length };
    }
  },
});
