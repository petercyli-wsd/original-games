import { defineEval } from '@originals/game-sdk';
import { BET_LABEL, VOLATILITY, cashOut, liveChance, nextStep, reveal, stepRisk, type Settings, type Target } from './math';

// Each round samples a stopping rule: cash out after a random number of
// reveals, bail out when the next reveal's bust chance (the unlit share)
// passes a random threshold, take a profit above a random target, or play to
// the end. The first column is revealed by the bet itself, as in the game.
// Rounds also end on their own when a target is lost or the last one wins.
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${BET_LABEL[s.bet]}, ${s.count} target${s.count > 1 ? 's' : ''}, ${s.size}×${s.size})`,
    params: s,
  })),
  playRound(s, rng) {
    const rule = rng.int(4);
    const stopAfter = 1 + rng.int(2 * s.count);
    const riskCap = 0.15 + 0.7 * rng.next();
    const profit = 1.1 + 8 * rng.next();

    let targets: Target[] = [];
    let steps = 0;
    for (;;) {
      if (!nextStep(s, targets)) return { multiplier: cashOut(s, targets), steps };
      if (steps > 0) {
        const cash = cashOut(s, targets);
        if (rule === 0 && steps >= stopAfter) return { multiplier: cash, steps };
        if (rule === 1 && stepRisk(s, targets) > riskCap) return { multiplier: cash, steps };
        if (rule === 2 && cash >= profit) return { multiplier: cash, steps };
      }
      targets = reveal(s, targets, 1 + rng.int(s.size));
      steps++;
      if (liveChance(s, targets) === 0) return { multiplier: 0, steps };
    }
  },
});
