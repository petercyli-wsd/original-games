import { defineEval } from '@originals/game-sdk';
import { RTP, WALLS, activeWall, decided, drawSlips, initState, prizeOf, reach, startChance, winChance } from './math';

// One config per backed wall. Each round samples the player's behaviour: ride
// to the end, stop after a random number of reaches, or cash out once the
// value reaches a random target. The wall is chosen before the bet.
const LEVELS = ['extreme', 'high', 'medium', 'low'];

export default defineEval<{ me: number }>({
  configs: WALLS.map((N, me) => ({ label: `${LEVELS[me]} (wall ${N}, ${(startChance(me) * 100).toFixed(2)}%)`, params: { me } })),
  playRound({ me }, rng) {
    const stopAfter = rng.next() < 0.4 ? Infinity : 1 + rng.int(10);
    const target = rng.next() < 0.3 ? 1.2 * Math.exp(rng.next() * Math.log(30)) : Infinity;
    const prize = prizeOf(me);
    const F = drawSlips(rng.int);
    let s = initState();
    let steps = 0;
    while (activeWall(s) >= 0) {
      s = reach(s, F).next;
      steps++;
      const d = decided(s, me);
      if (d) return { multiplier: d === 'won' ? prize : 0, steps };
      if (steps >= stopAfter || prize * winChance(s, me) >= target * RTP) return { multiplier: prize * winChance(s, me), steps };
    }
    return { multiplier: 0, steps };
  },
});
