// Fairness audit: can any way of playing Respins beat the RTP? The only
// decision after the bet is cash out or spin again, and the respin count is
// locked while live. Exact: the optimal-stopping value (Snell envelope) over
// {cash out, spin} equals the cash-out value at every state, so no stopping
// rule returns more than RTP; and the hostile strategies are run through the
// real spin() / cashAfter().
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { CELLS, RESPINS, RTP, START, TARGET, cashAfter, prizeFor, spin, startGrid, winChance } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

describe('respins fairness', () => {
  it('optimal stopping is worth exactly the cash-out value at every state', () => {
    for (const L of RESPINS) {
      const V = (c: number, l: number): number => {
        const cash = prizeFor(L) * winChance(c, l, L);
        if (c >= TARGET || l === 0) return cash;
        const cont = ((CELLS - c) / CELLS) * V(c + 1, L) + (c / CELLS) * V(c, l - 1);
        return Math.max(cash, cont);
      };
      for (let c = START; c < TARGET; c++) for (let l = 1; l <= L; l++) expect(V(c, l)).toBeCloseTo(prizeFor(L) * winChance(c, l, L), 9);
      expect(V(START, L)).toBeCloseTo(RTP, 12);
    }
  });

  const strategies: Record<string, (c: number, l: number, L: number, cash: number) => boolean> = {
    'only spin when the spin is at least 80% a coin': (c) => (CELLS - c) / CELLS >= 0.8,
    'cash out the moment the value passes the stake': (_c, _l, _L, cash) => cash > 1,
    'play to the end': () => true,
    'cash out when a respin is gone': (_c, l, L) => l === L,
  };
  for (const [name, go] of Object.entries(strategies))
    it(`strategy "${name}" returns RTP on every setting`, () => {
      const rng = createRng(seededSource(21));
      for (const L of RESPINS) {
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const full = startGrid(rng);
          let l: number = L;
          let pay = 0;
          for (;;) {
            const s = spin(full, l, L, rng);
            if (s.hit) full[s.cell] = true;
            l = s.respins;
            pay = cashAfter(s, L);
            if (s.won || s.lost || !go(s.coins, l, L, pay)) break;
          }
          sum += pay;
          sq += pay * pay;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(sq / ROUNDS - mean * mean, 0) / ROUNDS);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      }
    });
});
