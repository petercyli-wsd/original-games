import { defineEval } from '@originals/game-sdk';
import { FAMILY_NAME, POP_CAP, VOLATILITY, cashValue, prize, sampleChildren, winChance, type Family, type Gens } from './math';

// Each simulated player mixes several stopping rules, so the eval covers many
// strategies at once: a random generation to stop at (30% play to the end),
// a nervous stop when the family's chance falls below a threshold, and a
// greedy stop once the cash-out reaches a profit target. The board's own rule
// (more than POP_CAP lines alive cashes out) applies to everyone.
export default defineEval<{ family: Family; gens: Gens }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${FAMILY_NAME[p.family].toLowerCase()}, ${p.gens} generations)`,
    params: p,
  })),
  playRound({ family, gens }, rng) {
    const stopAt = rng.next() < 0.3 ? gens : 1 + rng.int(gens);
    const minChance = rng.next() < 0.25 ? 0.2 + rng.next() * 0.7 : 0;
    const target = rng.next() < 0.2 ? 1 + rng.next() * prize(family, gens) : Infinity;
    let z = 1;
    for (let g = 1; ; g++) {
      let next = 0;
      for (let i = 0; i < z; i++) next += sampleChildren(family, rng.next());
      z = next;
      if (z === 0) return { multiplier: 0, steps: g };
      const cash = cashValue(family, gens, g, z);
      if (g >= gens || z > POP_CAP) return { multiplier: cash, steps: g };
      if (g >= stopAt || winChance(family, gens, g, z) < minChance || cash >= target) return { multiplier: cash, steps: g };
    }
  },
});
