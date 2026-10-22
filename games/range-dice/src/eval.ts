import { defineEval } from '@originals/game-sdk';
import { SIZE, clampWins, playBet, shift, withWins, type Direction, type Range } from './math';

// One config per volatility level. Each round samples the player's set-up the
// way people actually play: a win chance jittered ±10% around the level, a
// random direction (In or Out) and a random position for the range on the
// track. Every set-up returns exactly 99%, so no per-config rtp is needed.
const LEVELS = [
  { label: 'low (~90% chance)', chance: 90 },
  { label: 'medium (~49.5%)', chance: 49.5 },
  { label: 'high (~10%)', chance: 10 },
  { label: 'extreme (~1%)', chance: 1 },
];

export default defineEval<{ chance: number }>({
  configs: LEVELS.map(({ label, chance }) => ({ label, params: { chance } })),
  playRound({ chance }, rng) {
    const dir: Direction = rng.next() < 0.5 ? 'in' : 'out';
    const wins = clampWins((chance / 100) * SIZE * (0.9 + 0.2 * rng.next()));
    const sized = withWins({ low: 0, high: SIZE - 1, dir }, wins);
    const w = sized.high - sized.low + 1;
    const range: Range = shift(sized, Math.floor(rng.next() * (SIZE - w + 1)));
    return { multiplier: playBet(range, rng.next()).multiplier, steps: 1 };
  },
});
