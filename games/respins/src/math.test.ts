import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { CELLS, MAX_MULTIPLIER, RESPINS, RTP, START, TARGET, cashAfter, coinsOf, headline, prizeFor, spin, startGrid, winChance } from './math';

const rng = createRng(seededSource(5));

/** The closed form: (1 - (c/15)^l) * prod over later coins of (1 - (c'/15)^L). */
function closed(c: number, l: number, L: number) {
  if (c >= TARGET) return 1;
  let p = 1 - (c / CELLS) ** l;
  for (let k = c + 1; k < TARGET; k++) p *= 1 - (k / CELLS) ** L;
  return p;
}

describe('respins maths', () => {
  it('the table equals the closed form', () => {
    for (const L of RESPINS) for (let c = START - 2; c < TARGET; c++) for (let l = 1; l <= L; l++) expect(winChance(c, l, L)).toBeCloseTo(closed(c, l, L), 12);
  });

  it('is a martingale: E[P after one spin] = P now, at every state', () => {
    for (const L of RESPINS)
      for (let c = 1; c < TARGET; c++)
        for (let l = 1; l <= L; l++) {
          const hit = ((CELLS - c) / CELLS) * winChance(c + 1, L, L);
          const miss = (c / CELLS) * winChance(c, l - 1, L);
          expect(hit + miss).toBeCloseTo(winChance(c, l, L), 12);
        }
  });

  it('a coin always raises the chance and a miss always lowers it', () => {
    for (const L of RESPINS)
      for (let c = START; c < TARGET; c++)
        for (let l = 2; l <= L; l++) {
          expect(winChance(c + 1, L, L)).toBeGreaterThan(winChance(c, l, L));
          expect(winChance(c, l - 1, L)).toBeLessThan(winChance(c, l, L));
        }
  });

  it('more respins is safer and the range is at least 25:1', () => {
    const ps = RESPINS.map(headline);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
    expect(ps[ps.length - 1] / ps[0]).toBeGreaterThan(25);
  });

  it('matches a direct simulation of the raw game', () => {
    for (const L of RESPINS) {
      const n = 60_000;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        const full = startGrid(rng);
        let l: number = L;
        for (;;) {
          const s = spin(full, l, L, rng);
          if (s.hit) full[s.cell] = true;
          l = s.respins;
          if (s.won) {
            wins++;
            break;
          }
          if (s.lost) break;
        }
      }
      const p = headline(L);
      expect(Math.abs(wins / n - p)).toBeLessThan((4 * Math.sqrt(p * (1 - p))) / Math.sqrt(n));
    }
  });

  it('start grid has START coins; cash rule', () => {
    expect(coinsOf(startGrid(rng))).toBe(START);
    expect(cashAfter({ coins: TARGET, respins: 4, won: true, lost: false }, 4)).toBe(prizeFor(4));
    expect(cashAfter({ coins: 7, respins: 0, won: false, lost: true }, 4)).toBe(0);
  });

  it('eval: RTP within 4 SE, max within bound, rounds short', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 3 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });
});
