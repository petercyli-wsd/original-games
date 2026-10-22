import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, applyRoll, overshootChance, prizeFor, randomGates, winChance, type Die } from './math';

// Each round samples a player: some place their own gates (any layout is worth
// the same 99%), and they stop after a random number of rolls, when the next
// roll's overshoot share passes a personal risk cap, once the cash-out reaches
// a goal, or never (play to the last gate).
export default defineEval<{ die: Die; gates: readonly number[] }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (d${p.die}, gates ${p.gates.join('·')})`,
    params: p,
  })),
  playRound({ die, gates: preset }, rng) {
    const gates = rng.next() < 0.25 ? randomGates(preset.length, rng) : preset;
    const prize = prizeFor(gates, die);
    const stopAfter = rng.next() < 0.3 ? Infinity : 1 + rng.int(12);
    const riskCap = rng.next() < 0.3 ? 0.1 + rng.next() * 0.6 : 1;
    const goal = rng.next() < 0.2 ? 1.2 + rng.next() * 8 : Infinity;

    let pos = 0;
    let next = 0;
    for (let rolls = 1; ; rolls++) {
      const r = applyRoll(gates, pos, next, 1 + rng.int(die));
      if (r.outcome === 'bust') return { multiplier: 0, steps: rolls };
      if (r.outcome === 'win') return { multiplier: prize, steps: rolls };
      pos = r.to;
      next = r.next;
      const cash = prize * winChance(gates, die, pos, next);
      if (rolls >= stopAfter || cash >= goal || overshootChance(gates, die, pos, next) > riskCap) {
        return { multiplier: cash, steps: rolls };
      }
    }
  },
});
