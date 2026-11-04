import { defineEval } from '@originals/game-sdk';
import { DICE, ROLL_OFFS, START, VOLATILITY, cashOf, duelChances, matchOf, step } from './math';

/** The chance that backer x survives the next roll-off. */
export function surviveChance(x: number, s: { j: number; lost: boolean }): number {
  return s.lost ? 0 : duelChances(x)[s.j];
}

// Each round the simulated player backs the configured die and either plays to
// the top, stops after a random roll-off, or cashes out as soon as the next
// roll-off is too risky.
export default defineEval<{ die: number }>({
  configs: Object.entries(VOLATILITY).map(([level, die]) => ({ label: `${level} (d${DICE[die]})`, params: { die } })),
  playRound({ die }, rng) {
    const stopAfter = rng.next() < 0.3 ? ROLL_OFFS : 1 + rng.int(ROLL_OFFS);
    const riskCap = rng.next() < 0.25 ? 0.2 + rng.next() * 0.6 : 0;
    let s = START;
    let steps = 0;
    for (;;) {
      if (steps > 0 && surviveChance(die, s) < riskCap) return { multiplier: cashOf(die, s), steps };
      const { a, b } = matchOf(die, s);
      s = step(die, s, 1 + rng.int(a), 1 + rng.int(b));
      steps++;
      const cash = cashOf(die, s);
      if (cash === 0) return { multiplier: 0, steps };
      if (s.j >= ROLL_OFFS || steps >= stopAfter) return { multiplier: cash, steps };
    }
  },
});
