import { defineEval } from '@originals/game-sdk';
import { RISKS, cashAfter, pickHand, playThrow, type Pick, type Risk } from './math';

// One config per volatility level. Each round samples the player's behaviour:
// a random streak to stop at, a cash-out threshold, or playing to the config's
// deepest target, with a random hand pattern (fixed, random, or switching).
const LEVELS: { label: string; risk: Risk; deep: number }[] = [
  { label: 'low (Easy, up to 6 steps)', risk: 'easy', deep: 6 },
  { label: 'medium (Classic, up to 6 wins)', risk: 'classic', deep: 6 },
  { label: 'high (Hard, up to 4 wins)', risk: 'hard', deep: 4 },
  { label: 'extreme (Hard, up to 7 wins)', risk: 'hard', deep: 7 },
];

export default defineEval<{ risk: Risk; deep: number }>({
  configs: LEVELS.map(({ label, risk, deep }) => ({ label, params: { risk, deep } })),
  playRound({ risk, deep }, rng) {
    const s = rng.next();
    const stopAt = s < 0.3 ? deep : 1 + rng.int(deep);
    const cashAbove = rng.next() < 0.25 ? 1 + rng.next() * cashAfter(risk, deep) : Infinity;
    const style = rng.int(3);
    const fixed = rng.int(3) as Pick;
    let k = 0;
    let steps = 0;
    while (k < Math.min(stopAt, RISKS[risk].maxSteps)) {
      if (k > 0 && cashAfter(risk, k) >= cashAbove) break;
      const pick: Pick = style === 0 ? fixed : style === 1 ? 'random' : (((steps % 3) as Pick));
      const th = playThrow(risk, pickHand(pick, rng), rng);
      steps++;
      if (th.effect === 'bust') return { multiplier: 0, steps };
      if (th.effect === 'advance') k++;
    }
    return { multiplier: cashAfter(risk, k), steps };
  },
});
