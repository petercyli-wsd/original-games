import { defineEval } from '@originals/game-sdk';
import { MAJORITY, PRESETS, PRESET_IDS, cashMultiplier, drawColour, urnAfter, winChance, type PresetId } from './math';

// The simulated player mixes the ways people stop: cash out after a random
// number of draws, cash out once the win chance crosses a random threshold
// (either way), or play to the end. Cash-out is offered after every draw from
// the first; rounds end, as in the game, once one colour reaches the majority.
type Strategy = 'random-stop' | 'threshold' | 'to-the-end';
const STRATEGIES: Strategy[] = ['random-stop', 'threshold', 'to-the-end'];

export default defineEval<{ preset: PresetId }>({
  configs: PRESET_IDS.map((preset) => ({ label: `${PRESETS[preset].name} ${PRESETS[preset].blue}:${PRESETS[preset].red}`, params: { preset } })),
  playRound({ preset }, rng) {
    const strategy = STRATEGIES[rng.int(STRATEGIES.length)];
    const stopAfter = 1 + rng.int(2 * MAJORITY - 1);
    const p0 = winChance(preset, 0, 0);
    // Take profit above p0 × (1 + up), or cut losses below p0 × down.
    const up = 0.2 + rng.next();
    const down = rng.next() * 0.8;
    let b = 0;
    let r = 0;
    for (let d = 1; ; d++) {
      const urn = urnAfter(preset, b, r);
      if (drawColour(urn.blue, urn.red, rng.next()) === 'blue') b++;
      else r++;
      const p = winChance(preset, b, r);
      const stop =
        p === 0 ||
        p === 1 ||
        (strategy === 'random-stop' && d === stopAfter) ||
        (strategy === 'threshold' && (p >= Math.min(0.999, p0 * (1 + up)) || p <= p0 * down));
      if (stop) return { multiplier: cashMultiplier(preset, b, r), steps: d };
    }
  },
});
