import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, cashOutValue, onSide, prizeOf, samplePoint, sideChance, sideShare, type Settings } from './math';

type Strategy = 'end' | 'random' | 'risk' | 'target';

// Each simulated round samples a player: one who always plays to the end, one
// who cashes after a random number of reveals, one who cashes when the next
// reveal's win chance drops below a random threshold, and one who cashes once
// the cash-out reaches a random target. Outcomes come from the raw process
// (three uniform points, is the triangle acute?), never from the pricing
// formulas, so the eval checks the pricing end to end.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.arena}, ${s.side}, ${s.series} triangle${s.series > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const pick = rng.next();
    const strategy: Strategy = pick < 0.3 ? 'end' : pick < 0.6 ? 'random' : pick < 0.85 ? 'risk' : 'target';
    const stopAfter = 1 + rng.int(2 * s.series);
    const threshold = 0.15 + 0.7 * rng.next();
    const target = 1.1 + 4 * rng.next();
    const p = sideChance(s);

    const stop = (steps: number, cash: number, next: number) =>
      strategy === 'random' ? steps >= stopAfter : strategy === 'risk' ? next < threshold : strategy === 'target' ? cash >= target : false;

    const point = () => samplePoint(s.arena, rng.next(), rng.next());
    let steps = 0;
    for (let k = 0; k < s.series; k++) {
      if (k > 0) {
        const cash = cashOutValue(s, { settled: k, ab: null });
        if (stop(steps, cash, p)) return { multiplier: cash, steps };
      }
      // Reveal 1: A and B land.
      const a = point();
      const b = point();
      steps++;
      const r = sideShare(s, a, b);
      // A checkpoint only while C can still go either way (the game drops sure things itself).
      if (r > 0 && r < 1) {
        const cash = cashOutValue(s, { settled: k, ab: [a, b] });
        if (stop(steps, cash, r)) return { multiplier: cash, steps };
      }
      // Reveal 2: C lands.
      const c = point();
      steps++;
      if (!onSide(s.side, a, b, c)) return { multiplier: 0, steps };
    }
    return { multiplier: prizeOf(s), steps };
  },
});
