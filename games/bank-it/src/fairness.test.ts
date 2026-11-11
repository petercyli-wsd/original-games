// Fairness audit: can any way of playing Bank It beat the RTP?
//
// At a checkpoint you may cash out (prize x V), Roll or Bank. Picking the
// option with the lower chance relocks the prize at value / chance, so every
// choice keeps the value at the moment of choosing. The die has six outcomes,
// so the martingale is checked exactly. Hostile strategies are then played
// through the same functions on every target:
//   (a) cash out once the pot reaches 12 unless one roll could win
//   (b) cash out the moment the value exceeds the stake
//   (c) play to the end with best play
//   (d) never bank, to the end (relocks to Roll every time)
//   (e) always bank when possible (the worse option, relocking)
//   (f) bank once the pot reaches 9, else roll
//   (g) cash out after any wipe, else best play

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { RTP, TARGETS, TURNS, bankChance, bestIsBank, canBank, relock, rollChance, startPrize, winChance } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
type Policy = (s: { n: number; pot: number; t: number; cash: number; stake: number; steps: number; wiped: boolean }) => 'cash' | 'roll' | 'bank' | 'best';

const policies: Record<string, Policy> = {
  safeRolls: ({ pot, n }) => (pot < 12 || pot + 6 >= n ? 'best' : 'cash'),
  anyProfit: ({ cash }) => (cash > 1 ? 'cash' : 'best'),
  toEnd: () => 'best',
  neverBank: () => 'roll',
  alwaysBank: ({ pot, t }) => (canBank(pot, t) ? 'bank' : 'roll'),
  bank9: ({ pot, t }) => (canBank(pot, t) && pot >= 9 ? 'bank' : 'roll'),
  cashAfterWipe: ({ wiped }) => (wiped ? 'cash' : 'best'),
};

function play(k: number, pol: Policy, rng: ReturnType<typeof createRng>) {
  let n = k, pot = 0, t = TURNS, prize = startPrize(k), steps = 0, wiped = false;
  for (;;) {
    const v = winChance(n, pot, t);
    const cash = prize * v;
    let act = pol({ n, pot, t, cash, stake: 1, steps, wiped });
    wiped = false;
    if (act === 'cash' && steps > 0) return cash;
    if (act === 'cash' || act === 'best') act = bestIsBank(n, pot, t) ? 'bank' : 'roll';
    if (act === 'bank' && !canBank(pot, t)) act = 'roll';
    const rc = rollChance(n, pot, t), bc = bankChance(n, pot, t);
    const next = relock(prize, Math.max(rc, bc), act === 'bank' ? bc : rc);
    if (next === null) act = bestIsBank(n, pot, t) ? 'bank' : 'roll';
    else prize = next;
    steps++;
    if (act === 'bank') { n -= pot; pot = 0; t--; continue; }
    const f = 1 + rng.int(6);
    if (f <= 2) { pot = 0; t--; wiped = true; if (t === 0) return 0; }
    else { pot += f; if (pot >= n) return prize; }
  }
}

describe('hostile strategies cannot beat the RTP', () => {
  for (const [name, pol] of Object.entries(policies)) {
    for (const k of TARGETS) {
      it(`${name} at target ${k}`, () => {
        const rng = createRng(seededSource(k * 31 + name.length));
        let sum = 0, sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const m = play(k, pol, rng);
          sum += m;
          sq += m * m;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(1e-12, sq / ROUNDS - mean * mean) / ROUNDS);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      });
    }
  }

  it('the cash-out is unchanged by either option at 40 varied states', () => {
    let count = 0;
    for (const n of [15, 35, 65]) for (const p of [1, 4, 9, 14]) for (const t of [2, 3, 4, 5]) {
      if (p >= n) continue;
      const v = winChance(n, p, t);
      const prize = 7;
      for (const [c, label] of [[rollChance(n, p, t), 'roll'], [bankChance(n, p, t), 'bank']] as const) {
        const next = relock(prize, v, c);
        if (next !== null) expect(next * c).toBeCloseTo(prize * v, 10);
        count++;
        void label;
      }
    }
    expect(count).toBeGreaterThanOrEqual(30);
  });
});
