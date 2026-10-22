import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, cashOutValue, onSide, prizeOf, sideChance, sideFraction, type Settings } from './math';

type Strategy = 'end' | 'random' | 'risk' | 'target';

// Each simulated round samples a player: one who always plays to the end, one
// who cashes after a random number of reveals, one who cashes when the next
// reveal's win chance drops below a random threshold, and one who cashes once
// the cash-out reaches a random target. Outcomes come from the raw process
// (uniform centre, uniform direction, does it touch a line?), never from the
// pricing formulas, so the eval checks the pricing end to end.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.floor}, ${s.side}, ℓ ${s.length.toFixed(2)}, ${s.needles} needle${s.needles > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const pick = rng.next();
    const strategy: Strategy = pick < 0.3 ? 'end' : pick < 0.6 ? 'random' : pick < 0.85 ? 'risk' : 'target';
    const stopAfter = 1 + rng.int(2 * s.needles);
    const threshold = 0.15 + 0.7 * rng.next();
    const target = 1.1 + 4 * rng.next();
    const p = sideChance(s);

    // At a checkpoint: cash, given the cash-out now and the next reveal's win chance?
    const stop = (steps: number, cash: number, next: number) =>
      strategy === 'random' ? steps >= stopAfter : strategy === 'risk' ? next < threshold : strategy === 'target' ? cash >= target : false;

    let steps = 0;
    for (let k = 0; k < s.needles; k++) {
      if (k > 0) {
        const cash = cashOutValue(s, { settled: k, landed: null });
        if (stop(steps, cash, p)) return { multiplier: cash, steps };
      }
      // Reveal 1: the centre lands.
      const centre = { u: rng.next(), v: rng.next() };
      steps++;
      const r = sideFraction(s, centre);
      // A checkpoint only when the spin is still open (the game auto-spins sure things).
      if (r > 0 && r < 1) {
        const cash = cashOutValue(s, { settled: k, landed: centre });
        if (stop(steps, cash, r)) return { multiplier: cash, steps };
      }
      // Reveal 2: the needle spins to a uniform direction.
      const theta = Math.PI * rng.next();
      steps++;
      if (!onSide(s, centre, theta)) return { multiplier: 0, steps };
    }
    return { multiplier: prizeOf(s), steps };
  },
});
