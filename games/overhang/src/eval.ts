import { defineEval } from '@originals/game-sdk';
import { MODES, MODE_NAMES, simulate, type Mode } from './math';

// The simulated player picks a random target multiplier each round and cashes
// out as soon as it is reached. 70% of the time the target is modest (log-uniform
// 1×–20×), otherwise anything up to twice the cap; targets above the cap
// play on until the round auto-cashes, so every auto-cash rule is exercised.
export default defineEval<{ mode: Mode }>({
  configs: MODE_NAMES.map((mode) => ({ label: `${mode} (s=${MODES[mode].s})`, params: { mode } })),
  playRound({ mode }, rng) {
    const top = rng.next() < 0.7 ? 20 : 2 * MODES[mode].cap;
    const target = Math.exp(rng.next() * Math.log(top));
    const { multiplier, drops } = simulate(mode, (_, mult) => mult >= target, rng.next);
    return { multiplier, steps: drops };
  },
});
