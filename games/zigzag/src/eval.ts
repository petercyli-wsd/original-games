import { defineEval } from '@originals/game-sdk';
import { RTP, VOLATILITY, prizeFor, stepSafe, survives, winChance, type Settings } from './math';

// Each round samples the player: play to the end, stop after a random number
// of bars, stop once the next bar's safe zone shrinks below a threshold, or
// take a profit once the cash-out passes a target. Sometimes the player
// flips the "either first direction" option (a choice that moves volatility,
// never EV).
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${p.n} bars${p.either ? ', either way' : ''})`,
    params: p,
  })),
  playRound(base, rng) {
    const s: Settings = rng.next() < 0.15 ? { ...base, either: !base.either } : base;
    const prize = prizeFor(s);
    const style = rng.next();
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(s.n - 1) : s.n;
    const safeFloor = style >= 0.55 && style < 0.8 ? 0.2 + rng.next() * 0.5 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.2 + 3 * rng.next()) : Infinity;

    const bars = [rng.next()];
    for (;;) {
      if (bars.length >= s.n) return { multiplier: prize, steps: bars.length };
      const cash = prize * winChance(bars, s);
      if (bars.length >= stopAfter || stepSafe(bars, s.either) < safeFloor || cash >= profitAt) return { multiplier: cash, steps: bars.length };
      const y = rng.next();
      if (!survives(bars, y, s.either)) return { multiplier: 0, steps: bars.length + 1 };
      bars.push(y);
    }
  },
});
