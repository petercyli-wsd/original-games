import { defineEval } from '@originals/game-sdk';
import { RTP, countAlive, fullMask, has, landing, relock, startPrize, wheel, winChance, type Shape, type SliceCount } from './math';

interface Params {
  k: SliceCount;
  shape: Shape;
  /** The slice backed at the start (wheel index, A = 0). */
  mine: number;
}

const TARGETS = [1.5, 2, 3, 5, 10, 25];

// One config per volatility level. Each round samples the player's habit:
// play to the last slice, stop after a few spins, the Auto rule "cash out at
// ×N", or bail out once the cash-out has fallen. Some players also switch to
// another slice at checkpoints (cash-out kept, prize relocked).
export default defineEval<Params>({
  configs: [
    { label: 'low (5 mixed slices, back the smallest)', params: { k: 5, shape: 'mixed', mine: 1 } },
    { label: 'medium (6 mixed slices, back a mid slice)', params: { k: 6, shape: 'mixed', mine: 4 } },
    { label: 'high (8 mixed slices, back the biggest)', params: { k: 8, shape: 'mixed', mine: 0 } },
    { label: 'extreme (8 steep slices, back the biggest)', params: { k: 8, shape: 'steep', mine: 0 } },
  ],
  playRound({ k, shape, mine: mine0 }, rng) {
    const w = wheel(k, shape);
    let mine = mine0;
    let prize = startPrize(w, mine);
    let mask = fullMask(k);
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(k - 1) : Infinity;
    const target = habit >= 0.55 && habit < 0.8 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const bail = habit >= 0.8 ? (0.2 + 0.6 * rng.next()) * RTP : 0;
    const switcher = rng.next() < 0.25;
    let steps = 0;
    for (;;) {
      const { slice } = landing(w, mask, rng.next());
      steps++;
      if (slice === mine) return { multiplier: 0, steps };
      mask &= ~(1 << slice);
      if (countAlive(mask) === 1) return { multiplier: prize, steps };
      const cash = prize * winChance(w, mask, mine);
      if (steps >= stopAfter || cash >= target || cash < bail) return { multiplier: cash, steps };
      if (switcher && rng.next() < 0.4) {
        const pick = rng.int(k);
        if (has(mask, pick) && pick !== mine) {
          const r = relock(cash, w, mask, pick);
          if (r !== null) {
            mine = pick;
            prize = r;
          }
        }
      }
    }
  },
});
