import { defineEval } from '@originals/game-sdk';
import { BINS, HEIGHT, emptyStacks, landing, relock, startPrize, winChance } from './math';

interface Params {
  /** The bin backed at the start (0 = the 40% bin … 4 = the 5% bin). */
  mine: number;
}

const TARGETS = [1.5, 2, 3, 5, 10, 25, 50];

// One config per volatility level. Each round samples the player's habit:
// play to the finish, stop after a few balls, the Auto rule "cash out at ×N",
// or bail out once the cash-out has fallen. Some players also switch bins at
// checkpoints (cash-out kept, prize relocked).
export default defineEval<Params>({
  configs: [
    { label: 'low (back the 40% bin)', params: { mine: 0 } },
    { label: 'medium (back the 30% bin)', params: { mine: 1 } },
    { label: 'high (back the 15% bin)', params: { mine: 2 } },
    { label: 'extreme (back the 5% bin)', params: { mine: 4 } },
  ],
  playRound({ mine: mine0 }, rng) {
    let mine = mine0;
    let prize = startPrize(mine);
    const stacks = emptyStacks();
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(8) : Infinity;
    const target = habit >= 0.55 && habit < 0.8 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const bail = habit >= 0.8 ? (0.2 + 0.6 * rng.next()) * prize * winChance(stacks, mine) : 0;
    const switcher = rng.next() < 0.1;
    let steps = 0;
    for (;;) {
      const j = landing(rng.next());
      stacks[j]++;
      steps++;
      if (stacks[j] >= HEIGHT) return { multiplier: j === mine ? prize : 0, steps };
      const cash = prize * winChance(stacks, mine);
      if (steps >= stopAfter || cash >= target || cash < bail) return { multiplier: cash, steps };
      if (switcher && rng.next() < 0.25) {
        const pick = rng.int(BINS);
        if (pick !== mine) {
          const r = relock(cash, stacks, pick);
          if (r !== null) {
            mine = pick;
            prize = r;
          }
        }
      }
    }
  },
});
