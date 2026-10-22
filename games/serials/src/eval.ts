import { defineEval, type Volatility } from '@originals/game-sdk';
import { CUT_MAX, VOLATILITY, cashOut, drawSerial, drawTop, minCut, openingPrize, priorChance, relockPrize, winChance, type Settings } from './math';

// Each round samples a player:
//   - play to the end: watch every serial, then reveal N;
//   - random stop: cash out after a random number of serials;
//   - risk threshold: cash out once the win chance falls below a floor or
//     rises above a target (else reveal at the end);
//   - reveal early: stop drawing at a random point and reveal N.
// On top of that, a third of the rounds move the cut once, at a random
// checkpoint, to a random allowed position (re-locking the prize).
export default defineEval<Settings>({
  configs: (Object.entries(VOLATILITY) as [Volatility, Settings][]).map(([level, s]) => ({
    label: `${level} (N ≤ ${s.cut}, ${Math.round(priorChance(s.cut) * 100)}%, ${s.draws} serials)`,
    params: s,
  })),
  playRound(s, rng) {
    const n = drawTop(rng.next());
    const u = rng.next();
    const strategy = u < 0.25 ? 'end' : u < 0.5 ? 'stop' : u < 0.75 ? 'threshold' : 'early';
    const stopAt = 1 + rng.int(s.draws);
    const floor = 0.01 + rng.next() * 0.3;
    const target = 0.5 + rng.next() * 0.49;
    const recutAt = rng.next() < 0.35 ? 1 + rng.int(s.draws) : 0;

    let cut = s.cut;
    let prize = openingPrize(cut);
    const drawn: number[] = [];
    let max = 0;
    for (let j = 1; j <= s.draws; j++) {
      const x = drawSerial(n, drawn, rng.next());
      drawn.push(x);
      max = Math.max(max, x);
      if (max > cut) return { multiplier: 0, steps: j };
      if (j === recutAt) {
        const cash = cashOut(prize, j, max, cut);
        const lo = minCut(cash, j, max);
        cut = lo + rng.int(CUT_MAX - lo + 1);
        prize = relockPrize(cash, j, max, cut);
      }
      const p = winChance(j, max, cut);
      if (strategy === 'stop' && j === stopAt) return { multiplier: prize * p, steps: j };
      if (strategy === 'early' && j === stopAt) return { multiplier: n <= cut ? prize : 0, steps: j + 1 };
      if (strategy === 'threshold' && (p <= floor || p >= target)) return { multiplier: prize * p, steps: j };
    }
    return { multiplier: n <= cut ? prize : 0, steps: s.draws + 1 };
  },
});
