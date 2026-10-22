import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, grid, initialState, prizeFor, quickPicks, resolution, step, winChance, type QuickPick, type Size } from './math';

// Each round samples the player: the backed edges are drawn at random for
// the config (the choice; any IN / OUT mix), then the player plays to the
// end, stops after a random number of sweeps, cashes out once the live
// chance falls below a threshold, or takes a profit once the cash-out
// climbs past a target.
export default defineEval<{ size: Size; k: number; kind: QuickPick }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.size.replace('x', '×')}, ${p.k} edge${p.k > 1 ? 's' : ''}, ${p.kind} picks)`,
    params: p,
  })),
  playRound({ size, k, kind }, rng) {
    const picks = quickPicks(size, k, kind, rng);
    const prize = prizeFor(size, picks);
    const layers = grid(size).layers;

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(layers) : Infinity;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.1 + rng.next() * 0.5 : 0;
    const profitAt = style >= 0.8 ? prize * (0.3 + rng.next() * 0.6) : Infinity;

    let st = initialState(size);
    let steps = 0;
    for (;;) {
      const r = resolution(st, picks);
      if (r) return { multiplier: r === 'win' ? prize : 0, steps };
      const cash = prize * winChance(st, picks);
      if (steps > 0 && (steps >= stopAfter || cash < prize * riskFloor || cash >= profitAt)) return { multiplier: cash, steps };
      st = step(st, picks, rng).state;
      steps++;
    }
  },
});
