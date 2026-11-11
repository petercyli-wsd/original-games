import { defineEval } from '@originals/game-sdk';
import { FIELD, GAITS, RTP, chanceOf, leg, payout, startChances, type Track } from './math';

// One config per volatility level: which runner you back and on which track.
// Each round samples the player's behaviour: play to the line, stop after a
// random leg, or cash out once the value reaches a random target. The runner
// is chosen before the bet and never changes.
const CONFIGS: { level: string; L: Track; me: number }[] = [
  { level: 'low', L: 30, me: 1 },
  { level: 'medium', L: 20, me: 2 },
  { level: 'high', L: 40, me: 4 },
  { level: 'extreme', L: 20, me: 5 },
];

export default defineEval<{ L: Track; me: number }>({
  configs: CONFIGS.map(({ level, L, me }) => ({
    label: `${level} (#${me + 1} ${GAITS[FIELD[me].gait].name}, track ${L}, ${(startChances(L)[me] * 100).toFixed(1)}%)`,
    params: { L, me },
  })),
  playRound({ L, me }, rng) {
    const stopAfter = rng.next() < 0.4 ? Infinity : 1 + rng.int(8);
    const target = rng.next() < 0.3 ? 1.5 * Math.exp(rng.next() * Math.log(40)) : Infinity;
    const prize = RTP / startChances(L)[me];
    let pos = FIELD.map(() => 0);
    let legs = 0;
    for (;;) {
      const ticks = leg(pos, L, rng.next);
      legs++;
      const last = ticks[ticks.length - 1];
      if (last.winners) return { multiplier: payout(prize, me, last.winners), steps: legs };
      pos = last.pos;
      // Only what this strategy looks at is priced (the live game prices everything).
      const watching = target < Infinity || legs >= stopAfter;
      if (!watching) continue;
      const p = chanceOf(pos, L, me);
      const value = prize * p;
      if (p <= 0 || p >= 1 - 1e-12) return { multiplier: value, steps: legs };
      if (legs >= stopAfter || value >= target * RTP) return { multiplier: value, steps: legs };
    }
  },
});
