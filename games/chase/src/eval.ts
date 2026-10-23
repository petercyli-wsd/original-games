import { defineEval } from '@originals/game-sdk';
import { AUTO_TARGETS, RTP, moveOdds, playTurn, startChance, startState, table, winChance, type Settings } from './math';

// One config per volatility level. Each round samples the player's stopping
// rule: play to the end, cash out after a random number of turns, Auto's
// "cash out at ×N", or cash out as soon as some next step would be fatal
// (the hunter is adjacent) or the odds fall under a random floor.
const LEVELS: { label: string; params: Settings }[] = [
  { label: 'low (Yard, big head start, slow hunter)', params: { board: 'yard', gap: 'big', speed: 'slow' } },
  { label: 'medium (Hall, medium head start, slow hunter)', params: { board: 'hall', gap: 'medium', speed: 'slow' } },
  { label: 'high (Hall, medium head start, fast hunter)', params: { board: 'hall', gap: 'medium', speed: 'fast' } },
  { label: 'extreme (Hall, small head start, fast hunter)', params: { board: 'hall', gap: 'small', speed: 'fast' } },
];

export default defineEval<Settings>({
  configs: LEVELS.map(({ label, params }) => ({ label: `${label} · ${(startChance(params) * 100).toFixed(1)}%`, params })),
  playRound(settings, rng) {
    const t = table(settings.board, settings.speed);
    const prize = RTP / startChance(settings);
    const kind = rng.int(5);
    const stopTurn = kind === 1 ? 1 + rng.int(8) : Infinity;
    const target = kind === 2 ? AUTO_TARGETS[1 + rng.int(AUTO_TARGETS.length - 1)]! : Infinity;
    const cautious = kind === 3;
    const floor = kind === 4 ? startChance(settings) * (0.2 + 0.6 * rng.next()) : 0;

    let s = startState(settings.board, settings.gap);
    for (let turn = 1; ; turn++) {
      const r = playTurn(t, s, rng);
      if (r.end === 'escaped') return { multiplier: prize, steps: turn };
      if (r.end === 'caught') return { multiplier: 0, steps: turn };
      s = { runner: r.runner, hunter: r.hunter, phase: r.phase };
      const p = winChance(t, s);
      const cash = prize * p;
      if (turn >= stopTurn || cash >= target || p < floor) return { multiplier: cash, steps: turn };
      if (cautious && moveOdds(t, s).some((m) => m.p === 0)) return { multiplier: cash, steps: turn };
    }
  },
});
