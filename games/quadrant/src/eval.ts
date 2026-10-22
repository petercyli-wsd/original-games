import { defineEval } from '@originals/game-sdk';
import { TARGET_LABEL, VOLATILITY, cashOut, drawX, inTarget, normal, pLandGivenX, pPoint, prize, rhoOf, settles, type Settings } from './math';

type Strategy = 'end' | 'random' | 'risk' | 'target';

// Each simulated round samples a player:
//   - 'end' plays every reveal to the end;
//   - 'random' cashes out at a random checkpoint;
//   - 'risk' cashes out once the next reveal's chance of going on falls below
//     a random threshold (cut losses);
//   - 'target' cashes out once the cash-out reaches a random multiple (lock in).
// Outcomes come from the raw process (x standard normal, then
// y = ρx + √(1 − ρ²)·z), never from the pricing formulas, so the eval checks
// the pricing end to end. Every x and every y is one step.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${TARGET_LABEL[s.target].toLowerCase()}, ρ ${rhoOf(s.theta).toFixed(2)}, ${s.points} point${s.points > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const pick = rng.next();
    const strategy: Strategy = pick < 0.3 ? 'end' : pick < 0.55 ? 'random' : pick < 0.8 ? 'risk' : 'target';
    const stopAt = 1 + rng.int(2 * s.points);
    const threshold = 0.1 + 0.8 * rng.next();
    const goal = 1.05 + 3 * rng.next();
    const rho = rhoOf(s.theta);
    const full = prize(s);

    let steps = 0;
    let checkpoints = 0;
    // At a checkpoint with cash-out `cash`, where the next reveal goes on with chance `next`: stop?
    const stop = (cash: number, next: number) => {
      checkpoints++;
      if (strategy === 'random') return checkpoints >= stopAt;
      if (strategy === 'risk') return next < threshold;
      if (strategy === 'target') return cash >= goal;
      return false;
    };

    for (let landed = 0; landed < s.points; landed++) {
      // Between points: the next point lands with the single-point chance.
      if (landed > 0) {
        const cash = cashOut(s, { landed, x: null });
        if (stop(cash, pPoint(s.target, s.theta))) return { multiplier: cash, steps };
      }
      // Reveal x.
      const x = drawX(rng);
      steps++;
      const p = pLandGivenX(s.target, s.theta, x);
      if (!settles(p)) {
        const cash = cashOut(s, { landed, x });
        if (stop(cash, p)) return { multiplier: cash, steps };
      }
      // Reveal y.
      const y = rho * x + Math.sqrt(1 - rho * rho) * normal(rng);
      steps++;
      if (!inTarget(s.target, x, y)) return { multiplier: 0, steps };
    }
    return { multiplier: full, steps };
  },
});
