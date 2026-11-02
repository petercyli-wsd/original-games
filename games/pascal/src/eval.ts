import { defineEval } from '@originals/game-sdk';
import { START, VOLATILITY, mirror, prizeFor, rowOf, sealed, step, winChance, N, type Gate, type Pos } from './math';

// The simulated player samples a strategy every round:
//  - a random choice: the gate or its mirror image (same chance, other side);
//  - a pace: card by card, or "Run to the gate" straight after the first card;
//  - a stopping rule: a random card to cash out after (or never, playing to the
//    end), plus, sometimes, a cut-loss threshold (cash out when the live chance
//    falls below a fraction of the headline) and a lock-in threshold (cash out
//    when it climbs above a random level).
// The bet itself deals the first card, as in the game.
export default defineEval<{ gate: Gate }>({
  configs: Object.entries(VOLATILITY).map(([level, gate]) => ({
    label: `${level} (${gate.width} tile${gate.width > 1 ? 's' : ''} from tile ${gate.lo})`,
    params: { gate },
  })),
  playRound({ gate }, rng) {
    const g = rng.next() < 0.5 ? gate : mirror(gate);
    const prize = prizeFor(g);
    const p0 = winChance(START, g);
    const run = rng.next() < 0.15;
    const stopAt = rng.next() < 0.35 ? Infinity : 1 + rng.int(N);
    const cutBelow = rng.next() < 0.3 ? p0 * (0.2 + 0.6 * rng.next()) : -1;
    const lockAbove = rng.next() < 0.3 ? p0 + (1 - p0) * (0.2 + 0.7 * rng.next()) : 2;

    let pos: Pos = START;
    let steps = 0;
    for (;;) {
      pos = step(pos, rng);
      steps++;
      const fate = sealed(pos, g);
      if (fate) return { multiplier: fate === 'win' ? prize : 0, steps };
      if (run) continue;
      const p = winChance(pos, g);
      if (steps >= stopAt || p < cutBelow || p > lockAbove) return { multiplier: prize * p, steps };
      if (rowOf(pos) >= N) throw new Error('unsealed on the bottom row');
    }
  },
});
