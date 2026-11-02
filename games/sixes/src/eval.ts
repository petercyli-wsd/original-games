import { defineEval } from '@originals/game-sdk';
import { ROLLS, VOLATILITY, cashOutFor, face, prizeFor, winChance, type DiceCount } from './math';

// The simulated player mixes strategies round by round: play to the end,
// cash out after a random roll, or cash out once the win chance drops below
// (or rises above) a random threshold. Rolls are simulated die by die.
export default defineEval<{ n: DiceCount }>({
  configs: Object.entries(VOLATILITY).map(([level, n]) => ({ label: `${level} (${n} ${n === 1 ? 'die' : 'dice'})`, params: { n } })),
  playRound({ n }, rng) {
    const style = rng.next();
    const stopAfter = style < 0.35 ? ROLLS : style < 0.65 ? 1 + rng.int(ROLLS - 1) : ROLLS;
    const floor = style >= 0.65 && style < 0.85 ? rng.next() * 0.3 : 0;
    const ceiling = style >= 0.85 ? 0.2 + rng.next() * 0.6 : 1;
    let free: number = n;
    let rolls = 0;
    while (rolls < ROLLS) {
      let sixes = 0;
      for (let i = 0; i < free; i++) if (face(rng.next()) === 6) sixes++;
      free -= sixes;
      rolls++;
      if (free === 0) return { multiplier: prizeFor(n), steps: rolls };
      const left = ROLLS - rolls;
      if (left === 0) return { multiplier: 0, steps: rolls };
      const p = winChance(free, left);
      if (rolls >= stopAfter || p < floor || p >= ceiling) return { multiplier: cashOutFor(n, free, left), steps: rolls };
    }
    return { multiplier: 0, steps: rolls };
  },
});
