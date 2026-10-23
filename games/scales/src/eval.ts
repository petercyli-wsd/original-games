import { defineEval } from '@originals/game-sdk';
import { VOLATILITY, addBead, beadFrom, betLabel, chanceAt, forecast, prizeFor, settled, type Bet, type Pans } from './math';

// Each simulated player mixes the ways people play: stop after a random
// number of beads (or play to the end), bank once the cash-out passes a
// target (the Auto rule), or stop when the worst possible next bead would cut
// the chance by more than the player can stomach.
export default defineEval<{ n: number; bet: Bet }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.n} beads, ${betLabel(p.bet)})`, params: p })),
  playRound({ n, bet }, rng) {
    const prize = prizeFor(n, bet);
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(n);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 6 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.2 + rng.next() * 0.6 : 1;

    let s: Pans = { n, beads: [] };
    for (;;) {
      s = addBead(s, beadFrom(rng.next()));
      const steps = s.beads.length;
      const r = settled(s, bet);
      if (r) return { multiplier: r === 'win' ? prize : 0, steps };
      const now = chanceAt(s, bet);
      const cash = prize * now;
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      const f = forecast(s, bet);
      const worst = Math.min(...f.L, ...f.R);
      if (1 - worst / now > dropCap) return { multiplier: cash, steps };
    }
  },
});
