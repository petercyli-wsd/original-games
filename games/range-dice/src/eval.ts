import { defineEval } from '@originals/game-sdk';
import { SIZE, clampWins, playBet, withWins, type Config, type Mode } from './math';

// One config per volatility level. Each round samples the player's set-up the
// way people actually play: a win chance jittered ±10% around the level, a
// random mode (Roll in, Roll out or Roll between two) and random positions for
// the ranges on the track. Every set-up returns exactly 99%, so no per-config
// rtp is needed.
const LEVELS = [
  { label: 'low (~90% chance)', chance: 90 },
  { label: 'medium (~49.5%)', chance: 49.5 },
  { label: 'high (~10%)', chance: 10 },
  { label: 'extreme (~1%)', chance: 1 },
];

const MODES: Mode[] = ['in', 'out', 'two'];

export default defineEval<{ chance: number }>({
  configs: LEVELS.map(({ label, chance }) => ({ label, params: { chance } })),
  playRound({ chance }, rng) {
    const mode = MODES[rng.int(3)];
    const wins = clampWins(mode, (chance / 100) * SIZE * (0.9 + 0.2 * rng.next()));
    let range: Config;
    if (mode === 'two') {
      // Random sizes a1 + a2 = W, then random outer and middle gaps (middle ≥ 1).
      const a1 = 1 + rng.int(wins - 1);
      const a2 = wins - a1;
      const free = SIZE - wins;
      const g0 = rng.int(free - 1);
      const g1 = 1 + rng.int(free - g0 - 1);
      const low = g0;
      const high = low + a1 - 1;
      const low2 = high + 1 + g1;
      range = { mode, low, high, low2, high2: low2 + a2 - 1 };
    } else {
      const sized = withWins({ mode, low: 0, high: SIZE - 1, low2: 0, high2: 0 }, wins);
      const w = sized.high - sized.low + 1;
      const [min, max] = mode === 'out' ? [1, SIZE - 1 - w] : [0, SIZE - w];
      const low = min + rng.int(max - min + 1);
      range = { ...sized, low, high: low + w - 1 };
    }
    return { multiplier: playBet(range, rng.next()).multiplier, steps: 1 };
  },
});
