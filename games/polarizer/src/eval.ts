import { defineEval } from '@originals/game-sdk';
import { GOAL, RTP, TURNS, VOLATILITY, afterPass, nextTurn, passChance, passes, type Turn } from './math';

// Each simulated round starts with the config's turn size and then samples a
// player: some stop after a random number of polarizers, some stop once the
// next pass chance drops below a threshold, some play through to 90°, and some
// nudge the turn size to a neighbouring chip at random checkpoints (an
// EV-neutral choice that only moves the variance).
export default defineEval<{ turn: Turn }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${p.turn}° turns)`, params: p })),
  playRound({ turn }, rng) {
    const mode = rng.next();
    const stopAfter = mode < 0.35 ? 1 + rng.int(19) : Infinity;
    const minPass = mode >= 0.35 && mode < 0.55 ? 0.3 + rng.next() * 0.6 : 0;
    const wander = rng.next() < 0.3;
    let idx = TURNS.indexOf(turn);
    let angle = 0;
    let cash = RTP;
    // Step 1 is the free emission at 0°: the first checkpoint, before any polarizer.
    let steps = 1;
    while (angle < GOAL) {
      if (steps >= stopAfter) break;
      if (wander && rng.next() < 0.5) idx = Math.max(0, Math.min(TURNS.length - 1, idx + (rng.next() < 0.5 ? -1 : 1)));
      const d = nextTurn(angle, TURNS[idx]);
      if (passChance(d) < minPass) break;
      steps++;
      if (!passes(rng.next(), d)) return { multiplier: 0, steps };
      cash = afterPass(cash, d);
      angle += d;
    }
    return { multiplier: cash, steps };
  },
});
