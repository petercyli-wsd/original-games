import { defineEval } from '@originals/game-sdk';
import { TARGETS, TURNS, bankChance, bestIsBank, canBank, isWipe, relock, rollChance, startPrize, winChance } from './math';

// One config per target. Each round samples the player's habit: play to the
// end, stop after a few steps, the Auto rule "cash out at xN", or stop once
// the chance falls below a threshold. It also samples how Roll / Bank is
// chosen: always the best option, a random option (relocking the prize), a
// fixed "bank once the pot reaches X" rule, or never bank. Steps are rolls
// plus banks.
const CASH_TARGETS = [1.5, 2, 3, 5, 10, 25];

export default defineEval<{ k: number }>({
  configs: TARGETS.map((k) => ({ label: `target ${k}`, params: { k } })),
  playRound({ k }, rng) {
    let n = k;
    let pot = 0;
    let t = TURNS;
    let prize = startPrize(k);
    const habit = rng.next();
    const stopAfter = habit < 0.3 ? Infinity : habit < 0.55 ? 1 + rng.int(8) : Infinity;
    const target = habit >= 0.55 && habit < 0.75 ? CASH_TARGETS[rng.int(CASH_TARGETS.length)] : Infinity;
    const riskFloor = habit >= 0.75 ? 0.3 * rng.next() : 0;
    const chooser = rng.next();
    const bankAt = 4 + rng.int(12);
    let steps = 0;
    for (;;) {
      const cash = prize * winChance(n, pot, t);
      if (steps > 0 && (steps >= stopAfter || cash >= target || winChance(n, pot, t) < riskFloor * winChance(k, 0, TURNS))) return { multiplier: cash, steps };
      // Decide: roll or bank.
      let bank = false;
      if (canBank(pot, t)) {
        const best = bestIsBank(n, pot, t);
        if (chooser < 0.4) bank = best;
        else if (chooser < 0.6) bank = rng.int(2) === 0;
        else if (chooser < 0.85) bank = pot >= bankAt;
        else bank = false;
      }
      const best = Math.max(rollChance(n, pot, t), bankChance(n, pot, t));
      const chosen = bank ? bankChance(n, pot, t) : rollChance(n, pot, t);
      let next = relock(prize, best, chosen);
      if (next === null) {
        bank = bestIsBank(n, pot, t);
        next = prize;
      }
      prize = next;
      steps++;
      if (bank) {
        n -= pot;
        pot = 0;
        t--;
        continue;
      }
      const face = 1 + rng.int(6);
      if (isWipe(face)) {
        pot = 0;
        t--;
        if (t === 0) return { multiplier: 0, steps };
      } else {
        pot += face;
        if (pot >= n) return { multiplier: prize, steps };
      }
    }
  },
});
