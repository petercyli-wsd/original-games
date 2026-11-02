import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, closes, fullBox, playableChance, relock, rollDice, startPrize, winChance, type Box } from './math';

const TARGETS = [1.5, 2, 3, 5, 10, 25];

// One config per volatility level. Each round samples the player's habit:
// play to the end, stop after a few rolls, the Auto rule "cash out at ×N", or
// stop once the next roll's playable share drops below a threshold. Each
// round also samples how tiles are chosen: always the best close, a random
// legal close (relocking the prize), or "close the highest tiles first".
export default defineEval<{ n: Box }>({
  configs: Object.entries(VOLATILITY).map(([level, n]) => ({ label: `${level} (box of ${n})`, params: { n } })),
  playRound({ n }, rng) {
    let mask = fullBox(n);
    let prize = startPrize(n);
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(6) : Infinity;
    const target = habit >= 0.55 && habit < 0.75 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const riskFloor = habit >= 0.75 ? 0.4 + 0.5 * rng.next() : 0;
    const chooser = rng.next();
    let steps = 0;
    for (;;) {
      const cash = prize * winChance(mask);
      if (steps > 0 && (steps >= stopAfter || cash >= target || playableChance(mask) < riskFloor)) return { multiplier: cash, steps };
      const { total } = rollDice(mask, (k) => rng.int(k));
      steps++;
      const options = closes(mask, total);
      if (options.length === 0) return { multiplier: 0, steps };
      const best = options[0];
      let pick = best;
      if (chooser < 0.3) pick = options[rng.int(options.length)];
      else if (chooser < 0.5) pick = [...options].sort((a, b) => b.tiles - a.tiles)[0];
      const next = relock(prize, best.win, pick);
      if (next === null) pick = best;
      else prize = next;
      mask = pick.after;
      if (mask === 0) return { multiplier: prize, steps };
    }
  },
});
