// Arc Climb: each spin lands in the green arc with probability p (the arc is
// p of the circle). After s wins in a row the cash-out is RTP / p^s, so the
// expected value of stopping at any step is exactly RTP: no strategy beats any
// other. Rounds auto-cash at maxSteps to cap the top multiplier.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Mode = Extract<Volatility, 'low' | 'medium' | 'high'>;

export const MODES: Record<Mode, { p: number; maxSteps: number }> = {
  low: { p: 0.75, maxSteps: 12 },
  medium: { p: 0.5, maxSteps: 10 },
  high: { p: 0.25, maxSteps: 6 },
};

export const MODE_NAMES = Object.keys(MODES) as Mode[];

export function multiplierAt(mode: Mode, steps: number): number {
  return steps === 0 ? 0 : RTP / MODES[mode].p ** steps;
}

export const maxMultiplier = (mode: Mode) => multiplierAt(mode, MODES[mode].maxSteps);
