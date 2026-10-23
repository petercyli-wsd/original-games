import { defineEval } from '@originals/game-sdk';
import { MOVES, RTP, VOLATILITY, applyMove, canSwitch, drawMove, finalChances, moveBall, schedule, startBelief, type Setup } from './math';

// The simulated player samples a strategy each round: play to the reveal,
// stop after a random move, cash out once the bet is worth a random target,
// or switch to a random allowed cup at a random checkpoint. Every one of them
// should return RTP, because the cash-out is a martingale and switches keep it.
export default defineEval<Setup>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.cups} cups, ${s.blinds} blind, back cup ${s.slot + 1})`,
    params: s,
  })),
  playRound({ cups, blinds, slot: start }, rng) {
    const sched = schedule(blinds);
    let p = startBelief(cups);
    let ball = 0;
    let slot = start;
    let prize = RTP / finalChances(p, sched, 0)[slot];

    const r = rng.next();
    const kind = r < 0.3 ? 'end' : r < 0.55 ? 'stop' : r < 0.8 ? 'target' : 'switch';
    const stopAt = 1 + rng.int(MOVES);
    const target = 1.2 + rng.next() * 5;
    const switchAt = 1 + rng.int(MOVES);

    for (let done = 0; done < MOVES; ) {
      const { pair, swapped } = drawMove(rng, cups, sched[done]);
      p = applyMove(p, pair, sched[done]);
      ball = moveBall(ball, pair, swapped);
      done++;
      const q = finalChances(p, sched, done);
      const v = prize * q[slot];
      if (v === 0) return { multiplier: 0, steps: done };
      if (kind === 'stop' && done === stopAt) return { multiplier: v, steps: done };
      if (kind === 'target' && v >= target) return { multiplier: v, steps: done };
      if (kind === 'switch' && done === switchAt) {
        const options = q.flatMap((pt, t) => (t !== slot && canSwitch(v, pt) ? [t] : []));
        if (options.length) {
          slot = options[rng.int(options.length)];
          prize = v / q[slot];
        }
      }
    }
    return { multiplier: ball === slot ? prize : 0, steps: MOVES };
  },
});
