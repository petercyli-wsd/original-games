import { defineEval } from '@originals/game-sdk';
import { spin, tableFor, type Risk, type Segments } from './math';

// One config per volatility level. Each round samples the player's segment
// count within the level and spins once, exactly as the game does. Every
// (risk, segments) table returns exactly 99%, so no config needs an rtp override.
const LEVELS: { label: string; risk: Risk; segments: Segments[] }[] = [
  { label: 'low (Low risk, 10–50 segments)', risk: 'low', segments: [10, 20, 30, 40, 50] },
  { label: 'medium (Medium risk, 10–50 segments)', risk: 'medium', segments: [10, 20, 30, 40, 50] },
  { label: 'high (High risk, 10–20 segments)', risk: 'high', segments: [10, 20] },
  { label: 'extreme (High risk, 30–50 segments)', risk: 'high', segments: [30, 40, 50] },
];

export default defineEval<{ risk: Risk; segments: Segments[] }>({
  configs: LEVELS.map(({ label, risk, segments }) => ({ label, params: { risk, segments } })),
  playRound({ risk, segments }, rng) {
    const n = segments[rng.int(segments.length)];
    const { multiplier } = spin(() => rng.next(), tableFor(risk, n));
    return { multiplier, steps: 1 };
  },
});
