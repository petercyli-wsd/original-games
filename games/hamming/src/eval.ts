import { defineEval } from '@originals/game-sdk';
import { BITS, RTP, VOLATILITY, cashAt, decided, prizeFor, sendBit, START, winChance, type Settings } from './math';

// Each round samples the player: some send bit by bit, some a block at a
// time (the "Send rest of block" burst), and they either play to the end,
// stop after a random number of decisions, stop once the live win chance
// falls below a floor, or take a profit once the cash-out passes a target.
// A step is one decision (one bit, or one burst).
export default defineEval<Settings>({
  configs: Object.entries(VOLATILITY).map(([level, s]) => ({
    label: `${level} (${s.side}, ${s.noise}% noise, ${s.blocks} block${s.blocks > 1 ? 's' : ''})`,
    params: s,
  })),
  playRound(s, rng) {
    const prize = prizeFor(s);
    const burst = rng.next() < 0.4;
    const style = rng.next();
    const maxSteps = burst ? s.blocks : s.blocks * BITS;
    const stopAfter = style >= 0.3 && style < 0.55 ? 1 + rng.int(maxSteps) : Infinity;
    const riskFloor = style >= 0.55 && style < 0.8 ? 0.1 + rng.next() * 0.6 : 0;
    const profitAt = style >= 0.8 ? RTP * (1.05 + rng.next()) : Infinity;

    let st = START;
    let steps = 0;
    for (;;) {
      // One decision: a single bit, or bits until the block ends or the round is settled.
      const bits = burst ? (st.sent === BITS ? BITS : BITS - st.sent) : 1;
      for (let i = 0; i < bits && !decided(s, st); i++) st = sendBit(st, rng.next() < s.noise / 100);
      steps++;
      if (decided(s, st)) return { multiplier: winChance(s, st) > 0.5 ? prize : 0, steps };
      const cash = cashAt(s, st);
      if (steps >= stopAfter || winChance(s, st) < riskFloor || cash >= profitAt) return { multiplier: cash, steps };
    }
  },
});
