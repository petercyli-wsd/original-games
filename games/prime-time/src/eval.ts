import { defineEval, type Rng } from '@originals/game-sdk';
import {
  BET_LABEL,
  VOLATILITY,
  allHidden,
  cashOut,
  decided,
  digitAt,
  fanStat,
  hiddenPositions,
  lowest,
  rangeSize,
  reveal,
  winChance,
  type Bet,
  type Digits,
  type Revealed,
} from './math';

type Order = 'random' | 'left' | 'right' | 'safest' | 'riskiest';
const ORDERS: Order[] = ['random', 'random', 'left', 'right', 'safest', 'riskiest'];

/** Which hidden digit the simulated player opens next. */
function pick(bet: Bet, r: Revealed, order: Order, rng: Rng) {
  const hidden = hiddenPositions(r);
  if (order === 'left') return hidden[0];
  if (order === 'right') return hidden[hidden.length - 1];
  if (order === 'random') return hidden[rng.int(hidden.length)];
  // By the bust share drawn under each tile: lowest first, or highest first.
  const busts = hidden.map((pos) => fanStat(bet, r, pos).bust);
  const target = order === 'safest' ? Math.min(...busts) : Math.max(...busts);
  return hidden[busts.indexOf(target)];
}

// Each round samples a reveal order (random digit each time, left to right,
// last digit first, or by the drawn bust risk) and a stopping rule: cash out
// after a random number of reveals, bail out when the chance falls below a
// random threshold, take a profit above a random target, or play every
// digit. Rounds also end on their own when no winner or only winners remain.
export default defineEval<{ bet: Bet; digits: Digits }>({
  configs: Object.entries(VOLATILITY).map(([level, p]) => ({ label: `${level} (${BET_LABEL[p.bet]}, ${p.digits} digits)`, params: p })),
  playRound({ bet, digits }, rng) {
    const n = lowest(digits) + rng.int(rangeSize(digits));
    const order = ORDERS[rng.int(ORDERS.length)];
    const rule = rng.int(4);
    const stopAfter = 1 + rng.int(digits);
    const p0 = winChance(bet, allHidden(digits));
    const floor = p0 * (0.3 + 0.7 * rng.next());
    const target = 1.2 + 4 * rng.next();

    let r = allHidden(digits);
    let steps = 0;
    for (;;) {
      const pos = pick(bet, r, order, rng);
      r = reveal(r, pos, digitAt(n, digits, pos));
      steps++;
      const cash = cashOut(bet, r);
      if (decided(bet, r)) return { multiplier: cash, steps };
      if (rule === 0 && steps >= stopAfter) return { multiplier: cash, steps };
      if (rule === 1 && winChance(bet, r) < floor) return { multiplier: cash, steps };
      if (rule === 2 && cash >= target) return { multiplier: cash, steps };
    }
  },
});
