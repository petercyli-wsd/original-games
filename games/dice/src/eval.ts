import { defineEval } from '@originals/game-sdk';
import { MAX_CHANCE, MIN_CHANCE, chanceOf, multiplierFor, roll, targetFor, type Direction } from './math';

// One config per volatility level, each sampling targets and directions
// around its win chance, so the eval covers both directions and many targets.
const LEVELS = [
  { label: 'low (~90% chance)', chance: 90 },
  { label: 'medium (~49.5%)', chance: 49.5 },
  { label: 'high (~10%)', chance: 10 },
  { label: 'extreme (~1%)', chance: 1 },
];

export default defineEval<{ chance: number }>({
  configs: LEVELS.map(({ label, chance }) => ({ label, params: { chance } })),
  playRound({ chance }, rng) {
    const dir: Direction = rng.next() < 0.5 ? 'over' : 'under';
    const c = Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, Math.round(chance * (0.9 + 0.2 * rng.next()) * 100) / 100));
    const target = targetFor(c, dir);
    const { win } = roll(rng.next(), target, dir);
    return { multiplier: win ? multiplierFor(chanceOf(target, dir)) : 0, steps: 1 };
  },
});
