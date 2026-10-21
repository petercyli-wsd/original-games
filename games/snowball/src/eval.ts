import { defineEval } from '@originals/game-sdk';
import { PRESETS, PRESET_IDS, cashMultiplier, drawColour, winProbability, type Pace, type PresetId } from './math';

// The simulated player picks a random number of draws to stop after (1..N,
// where N means "play it out"), so the eval covers every cash-out strategy.
// Rounds end early, as in the game, once the outcome is decided. One config
// per preset at the standard pace, plus the setting with the top prize.
const config = (preset: PresetId, draws: Pace) => ({ label: `${PRESETS[preset].name} · ${draws} draws`, params: { preset, draws } });

export default defineEval<{ preset: PresetId; draws: Pace }>({
  configs: [...PRESET_IDS.map((preset) => config(preset, 21)), config('longshot', 11)],
  playRound({ preset, draws }, rng) {
    let { blue, red } = PRESETS[preset];
    const stopAfter = 1 + rng.int(draws);
    for (let d = 1; d <= draws; d++) {
      if (drawColour(blue, red, rng.next()) === 'blue') blue++;
      else red++;
      const p = winProbability(blue, red, draws - d);
      if (p === 0 || p === 1 || d === stopAfter) {
        return { multiplier: cashMultiplier(preset, draws, blue, red, draws - d), steps: d };
      }
    }
    throw new Error('unreachable: the last draw always decides the round');
  },
});
