import { defineEval } from '@originals/game-sdk';
import { DIRS, RTP, VOLATILITY, prizeFor, roll, startFaces, verdict, winChance, type Config, type Place } from './math';

// Each round samples the player. The call is the config's, except that "top"
// is randomly swapped for "bottom" (the same odds, a different choice). Then
// the player plays to the end, stops after a random number of rolls, cashes
// out once the live chance drops below a threshold, or takes a profit once
// the cash-out climbs past a target.
export default defineEval<Config>({
  configs: Object.entries(VOLATILITY).map(([level, c]) => ({
    label: `${level} (${c.cubes} cube${c.cubes > 1 ? 's' : ''}, ${c.target}, ${c.rolls} rolls)`,
    params: c,
  })),
  playRound({ rolls, cubes, target }, rng) {
    const call: Place = target === 'top' && rng.next() < 0.5 ? 'bottom' : target;
    const prize = prizeFor(rolls, cubes, call);

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(rolls) : rolls;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.05 + rng.next() * 0.5 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.2 + rng.next() * 3) : Infinity;

    let faces = startFaces(cubes);
    let done = 0;
    for (;;) {
      done++;
      faces = faces.map((f) => roll(f, DIRS[rng.int(4)]));
      const left = rolls - done;
      const v = verdict(faces, left, call);
      if (v === 'won') return { multiplier: prize, steps: done };
      if (v === 'lost') return { multiplier: 0, steps: done };
      const p = winChance(faces, left, call);
      const cash = prize * p;
      if (done >= stopAfter || p < riskFloor || cash >= profitAt) return { multiplier: cash, steps: done };
    }
  },
});
