import { defineEval } from '@originals/game-sdk';
import { RTP, MATCHES, playMatch, pWin, prizeFor, status, type K } from './math';

interface Params {
  k: K;
}

// Each round samples the player: play to the end, stop after a random number
// of matches, cash out once the chance falls below a floor, or take a profit.
export default defineEval<Params>({
  configs: [
    { label: 'low (1 upset)', params: { k: 1 } },
    { label: 'medium (3 upsets)', params: { k: 3 } },
    { label: 'high (4 upsets)', params: { k: 4 } },
    { label: 'extreme (5 upsets)', params: { k: 5 } },
  ],
  playRound({ k }, rng) {
    const prize = prizeFor(k);
    const style = rng.next();
    const stopAfter = style < 0.3 ? Infinity : style < 0.55 ? 1 + rng.int(MATCHES - 1) : Infinity;
    const floor = style >= 0.55 && style < 0.75 ? 0.3 + rng.next() * 0.5 : 0;
    const profitAt = style >= 0.75 ? RTP * (1.2 + rng.next() * 6) : Infinity;
    let res: number[] = [];
    const p0 = pWin(res, k);
    let steps = 0;
    for (;;) {
      res = [...res, playMatch(res, res.length, rng.next())];
      steps++;
      const s = status(res, k);
      if (s === 'won') return { multiplier: prize, steps };
      if (s === 'lost') return { multiplier: 0, steps };
      const p = pWin(res, k);
      if (steps >= stopAfter || p < floor * p0 || prize * p >= profitAt) return { multiplier: prize * p, steps };
    }
  },
});
