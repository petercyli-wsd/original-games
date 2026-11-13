import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, apply, cashOutFor, drawCard, prizeFor, startState, verdict, winChance, type Target } from './math';

// The simulated player mixes strategies round by round: play to the end, cash
// out after a random number of cards, or cash out once the win chance falls
// below (or rises above) a random threshold. A checkpoint follows every card.
export default defineEval<{ k: Target }>({
  configs: Object.entries(VOLATILITY).map(([level, k]) => ({ label: `${level} (lay ${k})`, params: { k } })),
  playRound({ k }, rng) {
    const style = rng.next();
    const stopAfter = style < 0.3 ? 99 : style < 0.55 ? 1 + rng.int(k) : 99;
    const floor = style >= 0.55 && style < 0.8 ? rng.next() * 0.5 : 0;
    const ceiling = style >= 0.8 ? 0.1 + rng.next() * 0.8 : 2;
    let s = startState();
    let steps = 0;
    for (;;) {
      const card = drawCard(rng.next(), s);
      s = apply(s, card).state;
      steps++;
      const v = verdict(k, s);
      if (v === 'won') return { multiplier: prizeFor(k), steps };
      if (v === 'lost') return { multiplier: 0, steps };
      const p = winChance(k, s);
      if (steps >= stopAfter || p < floor || p >= ceiling) return { multiplier: cashOutFor(k, s), steps };
    }
  },
});
