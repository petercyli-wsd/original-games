import { defineEval, type Rng } from '@originals/game-sdk';
import { EXPIRIES, barriersOf, playPosition, valueAt, type Direction, type Setup } from './math';

// One config per volatility level (a leverage band). Each round samples the
// whole setup and how the player plays it:
//  - direction, expiry, and take profit / stop loss each on or off at random,
//  - then one of: hold to the end (auto rules only), close by hand at a random
//    tick, or close on a trailing rule (lock in a gain once it has run, or
//    panic out after a drawdown).
// Every one of these is a stopping rule on a martingale, so each config
// should return exactly 99%.
const LEVELS = [
  { label: 'low (2–20×)', lo: 2, hi: 20 },
  { label: 'medium (25–120×)', lo: 25, hi: 120 },
  { label: 'high (150–450×)', lo: 150, hi: 450 },
  { label: 'extreme (500–1000×)', lo: 500, hi: 1000 },
];

const logUniform = (rng: Rng, lo: number, hi: number) => Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo)));

export default defineEval<{ lo: number; hi: number }>({
  configs: LEVELS.map(({ label, lo, hi }) => ({ label, params: { lo, hi } })),
  playRound({ lo, hi }, rng) {
    const setup: Setup = {
      lev: Math.round(logUniform(rng, lo, hi)),
      dir: (rng.next() < 0.5 ? 'up' : 'down') as Direction,
      expiry: EXPIRIES[rng.int(EXPIRIES.length)],
      tp: rng.next() < 0.5 ? Math.round(logUniform(rng, 1.01, 6) * 100) / 100 : null,
      sl: rng.next() < 0.4 ? Math.round((0.05 + rng.next() * 0.9) * 100) / 100 : null,
    };
    const b = barriersOf(setup);
    const style = rng.next();
    if (style < 0.4) {
      const r = playPosition(b, rng);
      return { multiplier: r.multiplier, steps: 1 };
    }
    if (style < 0.75) {
      const r = playPosition(b, rng, 1 + rng.int(b.T));
      return { multiplier: r.multiplier, steps: r.outcome === 'closed' ? 2 : 1 };
    }
    // Trailing rules: take a gain of g once reached, or bail after a drawdown of d.
    const gain = 1 + rng.next() * 1.5;
    const draw = 0.2 + rng.next() * 0.6;
    let peak = valueAt(0, b.n);
    const r = playPosition(b, rng, null, (k) => {
      const v = valueAt(k, b.n);
      peak = Math.max(peak, v);
      return v >= gain || v <= peak * (1 - draw);
    });
    return { multiplier: r.multiplier, steps: r.outcome === 'closed' ? 2 : 1 };
  },
});
