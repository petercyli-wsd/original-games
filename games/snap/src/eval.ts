import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, cutsLeft, longPiece, prizeFor, snapBreak, winChance, type Cuts } from './math';

// Each round samples the player: the break goes on either side of the stick
// and is nudged around the config's setting (the choice), then the player
// either plays to the end, stops after a random number of cuts, cashes out
// once the live chance falls below a threshold, or takes a profit once the
// cash-out climbs past a target.
export default defineEval<{ brk: number; cuts: Cuts }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (break ~${p.brk}%, ${p.cuts} cut${p.cuts > 1 ? 's' : ''})`,
    params: p,
  })),
  playRound({ brk, cuts }, rng) {
    const pct = snapBreak(brk + rng.int(5) - 2);
    const x = (rng.next() < 0.5 ? pct : 100 - pct) / 100;
    const prize = prizeFor(x, cuts);

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(cuts) : cuts; // a random stopping point, else to the end
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.15 + rng.next() * 0.6 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.05 + rng.next()) : Infinity;

    const breaks = [x];
    let fell = 0;
    for (;;) {
      const long = longPiece(breaks);
      const left = cutsLeft(breaks, cuts);
      const p = winChance(long?.length ?? null, left);
      const cash = prize * p;
      if (!long) return { multiplier: prize, steps: fell };
      if (left === 0) return { multiplier: 0, steps: fell };
      if (fell > 0 && (fell >= stopAfter || p < riskFloor || cash >= profitAt)) return { multiplier: cash, steps: fell };
      breaks.push(rng.next());
      fell++;
    }
  },
});
