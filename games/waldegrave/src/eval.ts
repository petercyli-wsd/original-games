import { defineEval } from '@originals/game-sdk';
import { SEAT_NAMES, VOLATILITY, branches, cashValue, newDuel, playDuel, prizeFor, winChance, type Settings } from './math';

type Strategy = 'end' | 'count' | 'risk' | 'profit' | 'champion';

// Each round samples a player: play every duel out, stop after a random
// number of duels, stop when the next duel could cut the chance too far (or
// it has sunk below a floor), take a profit target, or cash out as soon as
// the backed seat holds the table. Each action is one duel, or sometimes
// "play it out".
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.side} ${SEAT_NAMES[s.seat]}, ${s.players} players, ${s.streak} in a row)`,
    params: s,
  })),
  playRound(s, rng) {
    const prize = prizeFor(s);
    const u = rng.next();
    const strategy: Strategy = u < 0.25 ? 'end' : u < 0.5 ? 'count' : u < 0.7 ? 'risk' : u < 0.85 ? 'profit' : 'champion';
    const stopAfter = 1 + rng.int(2 ** s.streak);
    const maxDrop = 0.2 + 0.6 * rng.next();
    const floor = (0.2 + 0.7 * rng.next()) * winChance(newDuel(s.players), s.streak, s.seat, s.side);
    const target = 1 + rng.next() * (prize - 1) * 0.8;
    const autoShare = strategy === 'end' ? 0.5 : 0.1;

    let d = newDuel(s.players);
    let auto = false;
    for (;;) {
      d = playDuel(d, s.streak, rng.next() < 0.5);
      if (d.winner !== null) return { multiplier: winChance(d, s.streak, s.seat, s.side) === 1 ? prize : 0, steps: d.duels };
      if (auto) continue;
      const p = winChance(d, s.streak, s.seat, s.side);
      const cash = cashValue(d, s);
      const [a, b] = branches(d, s);
      const stop =
        (strategy === 'count' && d.duels >= stopAfter) ||
        (strategy === 'risk' && (Math.min(a, b) < p * (1 - maxDrop) || p < floor)) ||
        (strategy === 'profit' && cash >= target) ||
        (strategy === 'champion' && (s.side === 'back' ? d.order[0] === s.seat : d.order[0] !== s.seat && d.order[1] !== s.seat));
      if (stop) return { multiplier: cash, steps: d.duels };
      if (rng.next() < autoShare) auto = true;
    }
  },
});
