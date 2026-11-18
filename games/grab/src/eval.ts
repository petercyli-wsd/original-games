import { defineEval } from '@originals/game-sdk';
import { cashOf, chanceOf, layout, spin, type State } from './math';

// Each round the simulated player samples a habit: play to the end, stop after a random number of
// spins, cash out once the cash-out reaches a multiple, or bail out below a win chance.
export default defineEval<{ r: number }>({
  configs: [
    { label: 'low (1 red)', params: { r: 1 } },
    { label: 'medium (4 red)', params: { r: 4 } },
    { label: 'high (8 red)', params: { r: 8 } },
    { label: 'extreme (10 red)', params: { r: 10 } },
  ],
  playRound({ r }, rng) {
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(6) : Infinity;
    const target = habit >= 0.55 && habit < 0.8 ? 1 + rng.next() * 4 : Infinity;
    const floor = habit >= 0.8 ? 0.1 + rng.next() * 0.5 : 0;
    let s: State = { wedges: layout(r), hits: 0 };
    let steps = 0;
    for (;;) {
      const out = spin(s, rng.int(16));
      steps++;
      if (out.kind === 'red') return { multiplier: 0, steps };
      s = out.state;
      if (s.hits >= 2) return { multiplier: cashOf(s), steps };
      const cash = cashOf(s);
      if (steps >= stopAfter || cash >= target) return { multiplier: cash, steps };
      if (floor && chanceOf(s) < floor) return { multiplier: cash, steps };
    }
  },
});
