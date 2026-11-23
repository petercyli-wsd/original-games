// Fairness audit: can any way of playing In Between beat the RTP?
//
// The only decisions are the slot tap and when to cash out. Surviving a draw
// with s of n numbers fitting multiplies the cash-out by n/s, so for any slot
// policy E[next cash-out] = cash exactly. Checked here on the real functions:
//   - exact: at 30+ reached states, sum over every undrawn number x of
//     (1/n) * (x has a legal slot ? cash * n/s : 0) equals the cash-out
//     (to 1e-9), for the best, worst, end and a random slot rule;
//   - sampled: hostile strategies on every slot count, within 4 SE of RTP:
//     (a) draw only while the next number fits >= 80% of the time,
//     (b) cash out the moment the cash-out passes the stake,
//     (c) play to the end,
//     (d) always take the end slot, (e) always take the worst slot,
//     (f) the best slot all the way.
// The caps (s = 0, MAX_WIN) are stopping rules and leave RTP unchanged.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { simulateRound, type Habit } from './eval';
import { RTP, SLOTS, afterSafe, chooseSlot, dealPosts, drawNumber, emptyRow, fitCount, legalSlots, place, stepStop, undrawn, type Placement, type Row } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

describe('the cash-out is a martingale for every slot rule', () => {
  it('at 30+ varied reached states', () => {
    const rng = createRng(seededSource(11));
    let count = 0;
    for (const how of ['best', 'worst', 'end', 'random'] as Placement[]) {
      for (let t = 0; t < 40; t++) {
        const m = SLOTS[rng.int(5)]!;
        const { a, b } = dealPosts(rng, m);
        let row: Row = emptyRow(a, b, m);
        let cash = RTP;
        for (let k = 0; k < rng.int(m); k++) {
          if (stepStop(row, cash)) break;
          const x = drawNumber(rng, row);
          const slot = chooseSlot(row, x, how, rng.next());
          if (slot < 0) break;
          const next = afterSafe(cash, row);
          row = place(row, slot, x);
          cash = next;
        }
        if (stepStop(row, cash) || row.every((v) => v !== null)) continue;
        const n = undrawn(row);
        const used = new Set(row.filter((v): v is number => v !== null));
        let expected = 0;
        for (let x = 1; x <= 100; x++) {
          if (used.has(x)) continue;
          if (legalSlots(row, x).length > 0) expected += (1 / n) * afterSafe(cash, row);
        }
        expect(Math.abs(expected - cash)).toBeLessThan(1e-9);
        expect(fitCount(row).s).toBeGreaterThan(0);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(30);
  });
});

const HOSTILE: { name: string; h: (m: number) => Habit; extra?: (row: Row, cash: number) => boolean }[] = [
  { name: '(c) play to the end, best slot', h: () => ({ stopAfter: Infinity, cashAt: Infinity, minSafe: 0, placement: 'best' }) },
  { name: '(b) cash out once above the stake', h: () => ({ stopAfter: Infinity, cashAt: 1.0001, minSafe: 0, placement: 'best' }) },
  { name: '(d) always the end slot', h: () => ({ stopAfter: Infinity, cashAt: Infinity, minSafe: 0, placement: 'end' }) },
  { name: '(e) always the worst slot', h: () => ({ stopAfter: Infinity, cashAt: Infinity, minSafe: 0, placement: 'worst' }) },
  { name: '(f) one number then cash out', h: () => ({ stopAfter: 1, cashAt: Infinity, minSafe: 0, placement: 'worst' }) },
  { name: '(a) draw only while 80% fit', h: () => ({ stopAfter: Infinity, cashAt: Infinity, minSafe: 0.8, placement: 'best' }) },
];

describe('hostile strategies cannot beat the RTP', () => {
  for (const s of HOSTILE) {
    for (const m of SLOTS) {
      it(`${s.name} at ${m} slots`, () => {
        const rng = createRng(seededSource(m * 97 + s.name.length));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const { multiplier } = simulateRound(m, rng, s.h(m));
          sum += multiplier;
          sq += multiplier * multiplier;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(1e-12, sq / ROUNDS - mean * mean) / ROUNDS);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      });
    }
  }
});
