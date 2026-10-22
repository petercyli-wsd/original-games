// The round runner shared by Manual and Auto play. Pure: no React, no timers.
// The game supplies `animate` (draws one pump, resolves false if the game was
// left mid-animation) and `settle` (pays the ticket and ends the round).

import { maxPumps, multiplier } from './math';

export type Step = { kind: 'safe'; pump: number; cash: number } | { kind: 'pop'; pump: number };

/** The outcome of the next pump after k safe pumps, read from the round's hidden layout. */
export function stepAt(positions: readonly boolean[], d: number, k: number): Step {
  return positions[k] ? { kind: 'pop', pump: k + 1 } : { kind: 'safe', pump: k + 1, cash: multiplier(d, k + 1) };
}

/**
 * Auto play: pump until `target` safe pumps (then cash out) or a pop. Calls
 * `settle` exactly once and resolves to the payout multiplier, or null if the
 * round was interrupted (the ticket then settles at its fair value).
 */
export async function runAutoRound({
  positions,
  d,
  target,
  animate,
  settle,
}: {
  positions: readonly boolean[];
  d: number;
  target: number;
  animate: (step: Step) => Promise<boolean>;
  settle: (multiplier: number, step: Step) => void;
}): Promise<number | null> {
  const t = Math.max(1, Math.min(target, maxPumps(d)));
  let last: Step | null = null;
  for (let k = 0; k < t; k++) {
    last = stepAt(positions, d, k);
    if (!(await animate(last))) return null;
    if (last.kind === 'pop') {
      settle(0, last);
      return 0;
    }
  }
  const m = multiplier(d, t);
  settle(m, last!);
  return m;
}
