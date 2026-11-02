import { defineEval } from '@originals/game-sdk';
import { AUTO_TARGETS, RTP, START_HINT, nextSteps, playTurn, startChance, startState, volatilityOf, winChance, type Start } from './math';

// One config per hunter start (one per volatility level). Each round samples
// the player's stopping rule: play to the end, cash out after a random number
// of turns, Auto's "cash out at ×N", cash out as soon as some next step would
// be fatal (a red arrow), or once the odds fall under a random floor.
const STARTS: Start[] = ['far', 'near', 'exit', 'block'];

export default defineEval<{ start: Start }>({
  configs: STARTS.map((start) => ({
    label: `${volatilityOf(start)} (hunter starts ${START_HINT[start]}) · ${(startChance(start) * 100).toFixed(2)}%`,
    params: { start },
  })),
  playRound({ start }, rng) {
    const prize = RTP / startChance(start);
    const kind = rng.int(5);
    const stopTurn = kind === 1 ? 1 + rng.int(8) : Infinity;
    const target = kind === 2 ? AUTO_TARGETS[1 + rng.int(AUTO_TARGETS.length - 1)]! : Infinity;
    const cautious = kind === 3;
    const floor = kind === 4 ? startChance(start) * (0.2 + 0.6 * rng.next()) : 0;

    let s = startState(start);
    for (let turn = 1; ; turn++) {
      const r = playTurn(s, rng);
      if (r.end === 'escaped') return { multiplier: prize, steps: turn };
      if (r.end === 'caught') return { multiplier: 0, steps: turn };
      s = { runner: r.runner, hunter: r.hunter };
      const p = winChance(s);
      const cash = prize * p;
      if (turn >= stopTurn || cash >= target || p < floor) return { multiplier: cash, steps: turn };
      if (cautious && nextSteps(s).some((m) => m.fate === 'caught')) return { multiplier: cash, steps: turn };
    }
  },
});
