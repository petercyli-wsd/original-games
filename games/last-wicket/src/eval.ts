import { defineEval } from '@originals/game-sdk';
import { SETTINGS, WHEEL_NAMES, WHEELS, OUT, after, bestWheel, cashOut, outOfReach, prize, relock, startState, volatilityOf, winChance, type Setting, type State } from './math';

// Each round the simulated player picks the best wheel, a fixed wheel or a
// random one (relocking the prize if it is not the best), and stops after a
// random number of balls, when the chance falls under a random floor, or plays
// to the end. A round is at most 12 balls.
export default defineEval<{ st: Setting }>({
  configs: SETTINGS.map((st) => ({ label: `${volatilityOf(st)} (${st.k} off ${st.balls})`, params: { st } })),
  playRound({ st }, rng) {
    const stopAfter = rng.next() < 0.3 ? Infinity : 1 + rng.int(st.balls);
    const floor = rng.next() < 0.25 ? rng.next() * 0.5 : 0;
    const style = rng.int(4); // 0 best, 1 always Block, 2 always Swing, 3 random
    let s: State = startState(st);
    let p = prize(st);
    let balls = 0;
    for (;;) {
      let w = bestWheel(s);
      if (style === 1) w = 'block';
      else if (style === 2) w = 'swing';
      else if (style === 3) w = WHEEL_NAMES[rng.int(2)];
      const np = relock(p, s, w);
      if (np === null) w = bestWheel(s);
      else p = np;
      const x = WHEELS[w][rng.int(12)];
      balls++;
      if (x === OUT) return { multiplier: 0, steps: balls };
      s = after(s, x);
      if (s.need === 0) return { multiplier: p, steps: balls };
      if (s.balls === 0 || outOfReach(s)) return { multiplier: 0, steps: balls };
      if (balls >= stopAfter || winChance(s) < floor) return { multiplier: cashOut(p, s), steps: balls };
    }
  },
});
