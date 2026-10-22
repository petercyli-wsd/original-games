import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, burstSize, clampLo, decided, prizeFor, sideOf, winChance, windowOf, type Settings, type Tally } from './math';

// Each round samples the player. The window is nudged around the config's
// placement and mirrored half the time (the choice). Then the player plays to
// the end, stops after a random number of drops, cashes out once the live
// chance falls below a threshold, or takes a profit once the cash-out passes
// a target. One step is one burst of points (at most five per round).
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.n} points, window ${s.lo}–${s.lo + s.width}%)`,
    params: s,
  })),
  playRound(base, rng) {
    let lo = base.lo + rng.int(7) - 3;
    if (rng.next() < 0.5) lo = 100 - base.width - lo;
    const s: Settings = { ...base, lo: clampLo(base.n, base.width, lo) };
    const { a, b } = windowOf(s);
    const prize = prizeFor(s);
    const burst = burstSize(s.n);
    const steps = Math.ceil(s.n / burst);

    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(steps) : Infinity;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.1 + rng.next() * 0.6 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.1 + rng.next() * 2) : Infinity;

    const t: Tally = { below: 0, inside: 0, above: 0 };
    let step = 0;
    for (;;) {
      step++;
      for (let i = 0; i < burst && !decided(s.n, t); i++) t[sideOf(rng.next(), a, b)]++;
      const d = decided(s.n, t);
      if (d === 'win') return { multiplier: prize, steps: step };
      if (d === 'bust') return { multiplier: 0, steps: step };
      const cash = prize * winChance(s.n, t, a, b);
      if (step >= stopAfter || cash < prize * riskFloor || cash >= profitAt) return { multiplier: cash, steps: step };
    }
  },
});
