import { defineEval } from '@originals/game-sdk';
import { DIFFICULTIES, DIFFICULTY_LABEL, MAX_ROLLS, RTP, VOLATILITY_OF, drawDice, maxFactor, pitCount, resolveRoll, stopReason, survival, type Difficulty } from './math';

/**
 * The most rolls a sampled player plans: no deeper than a run that survives at
 * least 0.3% of the time, so a finite sample can see it (deeper runs only add
 * sampling noise; every stopping rule is worth exactly 99%, see the tests).
 */
export function deepest(d: Difficulty): number {
  let n = MAX_ROLLS;
  while (n > 1 && survival(d, n) < 0.003) n--;
  return n;
}

/**
 * One round with a sampled player:
 * - 35%: a random fixed number of rolls (up to `deepest`), then cash out;
 * - 25%: cash out once the value reaches a random target;
 * - 20%: after each safe roll, cash out with a random per-roll chance;
 * - 20%: roll to the end of the planned run.
 * Every stopping rule is worth exactly 99% (see the tests).
 */
export default defineEval<{ d: Difficulty }>({
  configs: DIFFICULTIES.map((d) => ({ label: `${VOLATILITY_OF[d]} (${DIFFICULTY_LABEL[d]}, ${pitCount(d)} snake${pitCount(d) === 1 ? '' : 's'})`, params: { d } })),
  playRound({ d }, rng) {
    const T = deepest(d);
    const u = rng.next();
    let rolls = T;
    let target = 0;
    let quitChance = 0;
    if (u < 0.35) rolls = 1 + rng.int(T);
    else if (u < 0.6) {
      const hi = Math.log(Math.min(1000, RTP * maxFactor(d) ** T));
      target = Math.exp(Math.log(1.1) + rng.next() * (hi - Math.log(1.1)));
    } else if (u < 0.8) quitChance = 0.15 + 0.5 * rng.next();

    let cash = RTP;
    let done = 0;
    while (!stopReason(d, cash, done, { rolls, target })) {
      if (done > 0 && quitChance > 0 && rng.next() < quitChance) break;
      const [a, b] = drawDice(rng);
      const r = resolveRoll(d, cash, a, b);
      done++;
      if (r.pit) return { multiplier: 0, steps: done };
      cash = r.cash;
    }
    return { multiplier: cash, steps: done };
  },
});
