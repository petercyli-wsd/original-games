// The round runner shared by Auto play and the tests. Pure: no React, no timers.
// The game supplies `dice` (draws two dice), `animate` (draws one roll and
// resolves false if the game was left mid-animation) and `settle` (pays the
// ticket and ends the round).

import { RTP, resolveRoll, stopReason, type Difficulty, type Roll, type StopReason, type StopRule } from './math';

export type AutoOutcome = 'bitten' | StopReason;

/**
 * Rolls until a snake or the stop rule fires. Calls `settle` exactly once and
 * resolves to the payout multiplier, or null if the round was interrupted (the
 * ticket then settles at its fair value).
 */
export async function runAutoRound({
  d,
  rule,
  dice,
  animate,
  settle,
}: {
  d: Difficulty;
  rule: StopRule;
  dice: () => [number, number];
  animate: (roll: Roll, index: number) => Promise<boolean>;
  settle: (multiplier: number, outcome: AutoOutcome) => void;
}): Promise<number | null> {
  let pos = 0;
  let cash = RTP;
  for (let done = 0; ; done++) {
    const reason = stopReason(d, cash, done, { rolls: Math.max(1, rule.rolls), target: rule.target });
    if (reason) {
      settle(cash, reason);
      return cash;
    }
    const [a, b] = dice();
    const roll = resolveRoll(d, pos, cash, a, b);
    if (!(await animate(roll, done))) return null;
    if (roll.snake) {
      settle(0, 'bitten');
      return 0;
    }
    pos = roll.to;
    cash = roll.cash;
  }
}
