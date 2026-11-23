import { defineEval, type Rng } from '@originals/game-sdk';
import { RTP, SLOTS, VOL_OF, afterSafe, chooseSlot, dealPosts, drawNumber, emptyRow, fitCount, isFull, place, stepStop, type Placement, type Slots } from './math';

export interface Habit {
  /** Cash out once this many numbers are placed (Infinity = play on). */
  stopAfter: number;
  /** Cash out once the cash-out reaches this. */
  cashAt: number;
  /** Cash out when the next number fits less often than this. */
  minSafe: number;
  placement: Placement;
}

/** One round as Game.tsx plays it: deal, then Draw, tap, Draw... with the same stopping rules. */
export function simulateRound(m: Slots, rng: Rng, h: Habit): { multiplier: number; steps: number } {
  const { a, b } = dealPosts(rng, m);
  let row = emptyRow(a, b, m);
  let cash = RTP;
  let steps = 0;
  for (;;) {
    if (isFull(row)) return { multiplier: cash, steps };
    if (steps > 0) {
      if (stepStop(row, cash)) return { multiplier: cash, steps };
      if (steps >= h.stopAfter || cash >= h.cashAt) return { multiplier: cash, steps };
      const f = fitCount(row);
      if (f.s / f.n < h.minSafe) return { multiplier: cash, steps };
    } else if (stepStop(row, cash)) return { multiplier: cash, steps };
    const x = drawNumber(rng, row);
    steps++;
    const slot = chooseSlot(row, x, h.placement, rng.next());
    if (slot < 0) return { multiplier: 0, steps };
    const next = afterSafe(cash, row);
    row = place(row, slot, x);
    cash = next;
  }
}

const PLACEMENTS: Placement[] = ['best', 'best', 'random', 'end', 'worst'];

export function sampleHabit(rng: Rng, m: number): Habit {
  const u = rng.next();
  return {
    stopAfter: u < 0.3 ? Infinity : 1 + rng.int(m),
    cashAt: rng.next() < 0.25 ? 1.5 + rng.next() * 20 : Infinity,
    minSafe: 0,
    placement: PLACEMENTS[rng.int(PLACEMENTS.length)]!,
  };
}

export default defineEval<{ m: Slots }>({
  configs: SLOTS.map((m) => ({ label: `${m} slot${m > 1 ? 's' : ''} (${VOL_OF[m]})`, params: { m } })),
  playRound({ m }, rng) {
    return simulateRound(m, rng, sampleHabit(rng, m));
  },
});
