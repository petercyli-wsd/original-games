import { defineEval } from '@originals/game-sdk';
import { N, RTP, backedSeats, mod, spin, startPrize, winChance, winsAt, type SeatsBacked } from './math';

interface Params {
  seats: SeatsBacked;
}

const TARGETS = [1.2, 1.5, 2, 3, 5, 10];

// One config per volatility level: the one knob, seats backed. Each round
// samples the player's habit: play to the end, stop after a few spins (zero
// included: cash out at the first checkpoint), the Auto rule "cash out at
// ×N", or bail out once the odds have fallen.
export default defineEval<Params>({
  configs: [
    { label: 'low (back 9 seats)', params: { seats: 9 } },
    { label: 'medium (back 5 seats)', params: { seats: 5 } },
    { label: 'high (back 3 seats)', params: { seats: 3 } },
    { label: 'extreme (back 1 seat)', params: { seats: 1 } },
  ],
  playRound({ seats }, rng) {
    const picks = backedSeats(seats);
    const prize = startPrize(picks);
    const habit = rng.next();
    const stopAfter = habit < 0.25 ? Infinity : habit < 0.55 ? rng.int(9) : Infinity;
    const target = habit >= 0.55 && habit < 0.75 ? TARGETS[rng.int(TARGETS.length)] : Infinity;
    const bail = habit >= 0.75 ? (0.2 + 0.6 * rng.next()) * RTP : 0;
    let x = 0;
    let steps = 0;
    for (;;) {
      const cash = prize * winChance(x, picks);
      if (steps >= stopAfter || cash >= target || cash < bail) return { multiplier: cash, steps };
      const { blows, dir } = spin(rng.next);
      steps++;
      if (blows) return { multiplier: winsAt(x, picks) ? prize : 0, steps };
      x = mod(x + dir, N);
    }
  },
});
