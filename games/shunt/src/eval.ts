import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, arrive, cashOf, clearChance, initialYard, isCleared, nextRisk, type Cars } from './math';

// Each round the simulated player picks a stopping rule: play to the end, stop
// after a random number of arrivals, stop once the next car gets too risky,
// or stop once the clear chance falls below a threshold. The game finishes
// itself when the yard clears (or when only safe cars are left).
export default defineEval<{ n: Cars }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.n} cars)`, params: p })),
  playRound({ n }, rng) {
    const r = rng.next();
    const stopAt = r < 0.35 ? n : 1 + rng.int(n);
    const riskCap = rng.next() < 0.25 ? 0.15 + rng.next() * 0.5 : 1;
    const chanceFloor = rng.next() < 0.2 ? rng.next() * 0.3 : 0;
    let y = initialYard(n);
    let steps = 0;
    while (!isCleared(y)) {
      if (steps >= 1 && clearChance(y) === 1) break; // decided: auto-finish pays the prize
      if (steps >= stopAt || (steps >= 1 && (nextRisk(y) > riskCap || clearChance(y) < chanceFloor))) break;
      const car = y.rest[rng.int(y.rest.length)];
      y = arrive(y, car).yard;
      steps++;
      if (y.jammed !== null) return { multiplier: 0, steps };
    }
    return { multiplier: cashOf(y), steps };
  },
});
