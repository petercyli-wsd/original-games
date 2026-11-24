import { defineEval } from '@originals/game-sdk';
import { TARGETS, arrowCounts, prizeFor, start, tick, winChance, winner } from './math';

// Each simulated player mixes the ways people play: stop after a random number
// of ticks (or play to the end), cash out once the cash-out passes a target
// (the Auto rule), cash out right after the house takes a contested cell, or
// cash out whenever you have fewer arrows than the house.
export default defineEval<{ k: number }>({
  configs: TARGETS.map((k) => ({ label: `hold ${k}`, params: { k } })),
  playRound({ k }, rng) {
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(8);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const onContest = rng.next() < 0.15;
    const onFewer = rng.next() < 0.15;
    const prize = prizeFor(k);
    let s = start(k);
    let steps = 0;
    for (;;) {
      const t = tick(s, rng.next());
      s = t.after;
      steps++;
      const w = winner(s);
      if (w) return { multiplier: w === 'you' ? prize : 0, steps };
      const cash = prize * winChance(s);
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      if (onContest && t.contested && t.arrow.paint === 'house') return { multiplier: cash, steps };
      if (onFewer) {
        const a = arrowCounts(s);
        if (a.you < a.house) return { multiplier: cash, steps };
      }
    }
  },
});
