import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, afterDecay, atomsIn, fullMask, lastChance, nextChance, prizeFor, sampleDecay, switchPrize } from './math';

// Each simulated player mixes the ways people actually play: stop after a
// random number of decays (or hold to the end), stop once the next decay is
// too likely to be theirs, bank once the win chance passes a target, and in
// some rounds switch atoms at random checkpoints (value-preserving).
export default defineEval<{ k: number; atom: number }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.k} atoms, back #${p.atom})`,
    params: p,
  })),
  playRound({ k, atom }, rng) {
    const stopAfter = rng.next() < 0.3 ? Infinity : 1 + rng.int(k - 1);
    const riskCap = rng.next() < 0.25 ? 0.15 + rng.next() * 0.45 : 1;
    const bankAt = rng.next() < 0.2 ? 0.4 + rng.next() * 0.5 : 2;
    const switchy = rng.next() < 0.25;

    let backed = atom;
    let prize = prizeFor(k, atom);
    let mask = fullMask(k);
    let cash = RTP;
    let steps = 0;
    for (;;) {
      const d = sampleDecay(mask, rng);
      steps++;
      const r = afterDecay(prize, mask, backed, d.atom);
      if (r.outcome) return { multiplier: r.cash, steps };
      mask = r.mask;
      cash = r.cash;
      // Checkpoint: maybe switch, then decide whether to stop.
      if (switchy && rng.next() < 0.4) {
        const atoms = atomsIn(mask);
        backed = atoms[rng.int(atoms.length)];
        prize = switchPrize(cash, mask, backed);
      }
      if (steps >= stopAfter) break;
      if (nextChance(mask, backed) > riskCap) break;
      if (lastChance(mask, backed) >= bankAt) break;
    }
    return { multiplier: cash, steps };
  },
});
