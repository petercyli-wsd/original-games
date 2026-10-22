import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, bustChanceNext, cashValue, fitChance, follow, lastChance, limitFor, newBoard, open, pickFor, winChance, type BoxCount } from './math';

// Each round hides a fresh uniform permutation and samples a simulated
// player, so the eval covers many stopping rules at once. Every decision is
// "open one box" or "follow the loop" (which pauses before a loop's last
// chance), chosen per player style: box by box, loop by loop, or a random
// mix. Steps count decisions; the Bet itself opens the first box.
//   - random stop: cash out after a random number of decisions;
//   - risk threshold: cash out once the win chance falls below a random
//     fraction of the starting chance, or once the next box could bust;
//   - last-chance dodger: cash out at every loop's decider;
//   - play to the end: never cash out.
export default defineEval<{ n: BoxCount; limit: number }>({
  configs: Object.entries(VOLATILITY).map(([level, { n, share }]) => {
    const limit = limitFor(n, share);
    return { label: `${level} (${n} boxes, loops ≤ ${limit})`, params: { n, limit } };
  }),
  playRound({ n, limit }, rng) {
    const perm = rng.shuffle([...Array(n).keys()]);
    const pick = (b: Parameters<typeof pickFor>[0]) => pickFor(b, perm);
    const style = rng.next(); // < 0.3 box by box, < 0.7 loop by loop, else a random mix
    const plan = rng.next();
    const stopAfter = plan < 0.3 ? 1 + rng.int(12) : Infinity;
    const threshold = plan >= 0.3 && plan < 0.5 ? fitChance(n, limit) * (0.1 + 0.8 * rng.next()) : 0;
    const maxBust = plan >= 0.5 && plan < 0.6 ? rng.next() : 1;
    const dodgeLastChance = plan >= 0.6 && plan < 0.7;

    let b = open(newBoard(n, limit), pick(newBoard(n, limit)));
    let steps = 1;
    while (b.status === 'live') {
      if (steps >= stopAfter) break;
      if (winChance(b) < threshold) break;
      if (bustChanceNext(b) > maxBust) break;
      if (dodgeLastChance && lastChance(b)) break;
      const loop = style < 0.3 ? false : style < 0.7 ? true : rng.next() < 0.5;
      if (loop) {
        const seq = follow(b, pick);
        b = seq[seq.length - 1];
      } else {
        b = open(b, pick(b));
      }
      steps++;
    }
    return { multiplier: cashValue(b), steps };
  },
});
