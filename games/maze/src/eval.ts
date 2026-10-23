import { defineEval } from '@originals/game-sdk';
import { AUTO_TARGETS, ROLL, RTP, endOf, maze, roll, startChance, type MazeId, type Settings } from './math';

// One config per volatility level (a maze and one of its start presets). Each
// round samples the player's behaviour: play to the end, cash out after a
// random number of rolls, Auto's "cash out at ×N" (checked after every move),
// step one move at a time and cash out whenever a trap is next door, or cash
// out once the odds fall under a random floor (rolling or stepping at random).
const LEVELS: { label: string; maze: MazeId; preset: number }[] = [
  { label: 'low (Garden, safest start)', maze: 'garden', preset: 0 },
  { label: 'medium (Labyrinth, second start)', maze: 'labyrinth', preset: 1 },
  { label: 'high (Catacomb, third start)', maze: 'catacomb', preset: 2 },
  { label: 'extreme (Catacomb, wildest start)', maze: 'catacomb', preset: 3 },
];

export default defineEval<Settings>({
  configs: LEVELS.map(({ label, maze: id, preset }) => {
    const params = { maze: id, start: maze(id).presets[preset] };
    return { label: `${label} · ${(startChance(params) * 100).toFixed(1)}%`, params };
  }),
  playRound(settings, rng) {
    const m = maze(settings.maze);
    const prize = RTP / startChance(settings);
    const kind = rng.int(5);
    const stopAfter = kind === 1 ? 1 + rng.int(6) : Infinity;
    const target = kind === 2 ? AUTO_TARGETS[1 + rng.int(AUTO_TARGETS.length - 1)]! : Infinity;
    const floor = kind === 4 ? startChance(settings) * (0.2 + 0.6 * rng.next()) : 0;

    let at = settings.start;
    let moves = 0;
    for (let checkpoint = 1; ; checkpoint++) {
      // Auto checks its rule after every move; Manual checkpoints come after a roll or a single step.
      const n = kind === 2 || kind === 3 || (kind === 4 && rng.int(2) === 0) ? 1 : ROLL;
      const path = roll(m, at, n, rng);
      at = path[path.length - 1];
      moves += path.length;
      const steps = kind === 2 ? Math.ceil(moves / ROLL) : checkpoint;
      const end = endOf(m, at);
      if (end === 'exit') return { multiplier: prize, steps };
      if (end === 'trap') return { multiplier: 0, steps };
      const p = m.odds[at];
      const cash = prize * p;
      if (checkpoint >= stopAfter || cash >= target || p < floor) return { multiplier: cash, steps };
      if (kind === 3 && m.nbrs[at].some((c) => m.traps.includes(c))) return { multiplier: cash, steps };
    }
  },
});
