import { defineEval } from '@originals/game-sdk';
import { START, VOLATILITY, mirror, prizeFor, rowOf, sealed, step, winChance, type Gate, type Pos, type Size } from './math';

// The simulated player samples a strategy every round:
//  - a random choice: the gate or its mirror image (same chance, other side);
//  - a pace: step by step, or "Run to gate" straight after the first step;
//  - a stopping rule: a random step to cash out at (or never, playing to the end),
//    plus, sometimes, a cut-loss threshold (cash out when the live chance falls
//    below a fraction of the headline) and a lock-in threshold (cash out when it
//    climbs above a random level).
// The bet itself takes the first step, as in the game.
export default defineEval<{ n: Size; gate: Gate }>({
  configs: Object.entries(VOLATILITY).map(([level, { n, gate }]) => ({
    label: `${level} (${n}×${n}, row ${gate.row}, ${gate.width} tile${gate.width > 1 ? 's' : ''})`,
    params: { n, gate },
  })),
  playRound({ n, gate }, rng) {
    const g = rng.next() < 0.5 ? gate : mirror(n, gate);
    const prize = prizeFor(n, g);
    const p0 = winChance(n, START, g);
    const run = rng.next() < 0.15;
    const stopAt = rng.next() < 0.35 ? Infinity : 1 + rng.int(g.row);
    const cutBelow = rng.next() < 0.3 ? p0 * (0.2 + 0.6 * rng.next()) : -1;
    const lockAbove = rng.next() < 0.3 ? p0 + (1 - p0) * (0.2 + 0.7 * rng.next()) : 2;

    let pos: Pos = START;
    let steps = 0;
    for (;;) {
      pos = step(n, pos, rng);
      steps++;
      const fate = sealed(n, pos, g);
      if (fate) return { multiplier: fate === 'win' ? prize : 0, steps };
      if (run) continue;
      const p = winChance(n, pos, g);
      if (steps >= stopAt || p < cutBelow || p > lockAbove) return { multiplier: prize * p, steps };
      if (rowOf(pos) >= g.row) throw new Error('unsealed past the gate');
    }
  },
});
