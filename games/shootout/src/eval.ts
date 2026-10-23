import { defineEval } from '@originals/game-sdk';
import {
  MATCHUPS,
  PICKS,
  PICK_NAME,
  VOLATILITY,
  addKick,
  canSwitch,
  chanceOf,
  forecast,
  isGoal,
  kickChance,
  kicker,
  prizeFor,
  settled,
  switchPrize,
  EMPTY,
  type MatchupId,
  type Pick,
} from './math';

// Each simulated player mixes the ways people play: stop after a random
// number of kicks (or play to the end), bank once the cash-out passes a
// target (the Auto rule), stop when the next kick could hurt too much, and in
// some rounds switch outcome at random checkpoints (value-preserving).
export default defineEval<{ matchup: MatchupId; pick: Pick }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({
    label: `${level} (${MATCHUPS[p.matchup].label}, back ${PICK_NAME[p.pick]})`,
    params: p,
  })),
  playRound({ matchup, pick: first }, rng) {
    const m = MATCHUPS[matchup];
    const stopAfter = rng.next() < 0.35 ? Infinity : 1 + rng.int(10);
    const cashAt = rng.next() < 0.25 ? 1.2 + rng.next() * 4 : Infinity;
    const dropCap = rng.next() < 0.2 ? 0.15 + rng.next() * 0.5 : 1;
    const switchy = rng.next() < 0.2;

    let pick = first;
    let prize = prizeFor(m, pick);
    let s = EMPTY;
    let steps = 0;
    for (;;) {
      s = addKick(s, isGoal(rng.next(), kickChance(m, kicker(s))));
      steps++;
      const r = settled(s, pick);
      if (r) return { multiplier: r === 'win' ? prize : 0, steps };
      let cash = prize * chanceOf(s, m, pick);
      if (switchy && rng.next() < 0.3) {
        // Hedgers switch to an outcome that is still reasonably likely.
        const to = PICKS[rng.int(PICKS.length)];
        if (canSwitch(cash, s, m, pick, to) && chanceOf(s, m, to) >= 0.25) {
          prize = switchPrize(cash, s, m, to);
          pick = to;
          cash = prize * chanceOf(s, m, pick);
        }
      }
      if (steps >= stopAfter || cash >= cashAt) return { multiplier: cash, steps };
      // Risk stop: the worse branch of the next kick would cut the chance by more than dropCap.
      const f = forecast(s, m, pick);
      const now = chanceOf(s, m, pick);
      if (1 - Math.min(f.ifGoal, f.ifMiss) / now > dropCap) return { multiplier: cash, steps };
    }
  },
});
