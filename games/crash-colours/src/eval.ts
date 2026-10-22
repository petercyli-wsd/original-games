import { defineEval } from '@originals/game-sdk';
import { MOONS, SPLITS, crashPoint, multiplierOf, type Lines, type Stakes } from './math';

// One config per volatility level. Each samples the lines and the stake mix a
// player at that level would choose, so the eval covers every band, every
// line and hedged mixes. Every mix is priced to exactly 99%.
type Level = 'low' | 'medium' | 'high' | 'extreme';

const pick = <T>(xs: readonly T[], u: number) => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))];

function sampleBet(level: Level, u: () => number): { stakes: Stakes; lines: Lines } {
  const split = pick(SPLITS, u());
  const r = u();
  switch (level) {
    case 'low': {
      // Hedged: Red and Green together, in random proportions.
      const moon = pick(MOONS, u());
      return { stakes: { red: 0.5 + u(), green: 0.5 + u(), moon: 0 }, lines: { split, moon } };
    }
    case 'medium': {
      // A single colour, sometimes with a small Moon side bet.
      const moon = pick([5, 10, 20], u());
      const side = u() < 0.3 ? 0.05 + 0.1 * u() : 0;
      return { stakes: r < 0.5 ? { red: 1, green: 0, moon: side } : { red: 0, green: 1, moon: side }, lines: { split, moon } };
    }
    case 'high': {
      // Moon at the classic lines, sometimes covered by Green.
      const moon = pick([5, 10, 20, 50], u());
      return { stakes: { red: 0, green: r < 0.4 ? u() : 0, moon: 1 }, lines: { split, moon } };
    }
    case 'extreme': {
      const moon = pick([100, 1000], u());
      return { stakes: { red: r < 0.2 ? 0.2 * u() : 0, green: 0, moon: 1 }, lines: { split, moon } };
    }
  }
}

const LEVELS: { label: string; level: Level }[] = [
  { label: 'low (Red + Green hedge)', level: 'low' },
  { label: 'medium (one colour)', level: 'medium' },
  { label: 'high (Moon 5–50×)', level: 'high' },
  { label: 'extreme (Moon 100–1000×)', level: 'extreme' },
];

export default defineEval<{ level: Level }>({
  configs: LEVELS.map(({ label, level }) => ({ label, params: { level } })),
  playRound({ level }, rng) {
    const { stakes, lines } = sampleBet(level, () => rng.next());
    const crash = crashPoint(rng.next());
    return { multiplier: multiplierOf(stakes, crash, lines), steps: 1 };
  },
});
