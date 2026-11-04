// Fairness audit: can any way of playing Strip Roulette beat the RTP?
//
// A round is one spin: the layout (any mix of Red, Black, Green and Edge
// stakes) and the strip length are fixed before Bet and disabled while the
// strip spins, and one slot is drawn with drawSlot(rng.next(), n). There is
// no decision during a round, so the "martingale" is a single step: the bet
// is worth RTP before the spin and E[payout] after it must equal RTP for every
// layout. Strategies (a) "act only when the next step is ≥ 80% safe" and (b)
// "cash out the moment you are up" have nothing to act on and collapse to
// (c), a plain spin; the eval configs cover (c). The only lever a player has
// across rounds is stake sizing (manual or the auto-bet's on-win / on-loss
// rules), so (d) is a doubling progression (double every bet after a loss,
// reset after a win, stop once 10 units up or after 12 losses in a row),
// measured as total paid / total staked; and (e) a full hedge on every bet.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BET_KEYS, EMPTY_LAYOUT, MAX_MULTIPLIER, RTP, STRIPS, drawSlot, layoutStats, scaleLayout, spin, totalOf, type Layout } from './math';

/** Rounds per config; the audit's heavy run sets FAIRNESS_ROUNDS=200000 or more. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const cents = (x: number) => Math.round(x * 100) / 100;

describe('Strip Roulette fairness', () => {
  it('the draw is uniform: slot = floor(u · n) is exact for the host 32-bit uniforms', () => {
    // The host source returns j / 2^32, so u · n is computed exactly in floating
    // point and slot i gets ⌊2^32 / n⌋ or ⌈2^32 / n⌉ of the 2^32 values: a
    // relative bias below n / 2^32 ≈ 1e-8. Checked on a coarser dyadic grid,
    // where the same argument gives each slot ⌊2^20 / n⌋ or ⌈2^20 / n⌉ values.
    const N = 2 ** 20;
    for (const n of STRIPS) {
      const hits = new Array<number>(n).fill(0);
      for (let k = 0; k < N; k++) hits[drawSlot(k / N, n)]++;
      for (const h of hits) expect(h === Math.floor(N / n) || h === Math.ceil(N / n)).toBe(true);
      for (let k = 0; k < N; k += 997) expect(drawSlot(k / N, n)).toBe(Math.floor((k * n) / N));
      expect(drawSlot(1 - 2 ** -32, n)).toBe(n - 1);
    }
  });

  it('every layout, including auto-bet scaled ones, is worth exactly RTP over the n slots', () => {
    const rng = createRng(seededSource(3));
    let checked = 0;
    for (const n of STRIPS) {
      for (let t = 0; t < 60; t++) {
        let layout: Layout = { ...EMPTY_LAYOUT };
        for (const k of BET_KEYS) if (rng.next() < 0.6) layout[k] = cents(0.01 + rng.next() * 50);
        if (!(totalOf(layout) > 0)) layout.green = 0.01;
        // Auto-bet rescales the layout to a new total, rounding each bet to the cent.
        if (t % 2) layout = scaleLayout(layout, cents(0.05 + rng.next() * 200));
        const total = totalOf(layout);
        let ev = 0;
        let max = 0;
        for (let i = 0; i < n; i++) {
          const r = spin(layout, n, (i + 0.5) / n);
          expect(r.slot).toBe(i);
          ev += r.multiplier / n;
          max = Math.max(max, r.multiplier);
          // The settled multiplier pays exactly what the bets that hit are owed.
          expect(Math.abs(r.multiplier * total - r.paid)).toBeLessThan(1e-9 * Math.max(1, r.paid));
        }
        expect(ev).toBeCloseTo(RTP, 12);
        expect(layoutStats(layout, n).rtp).toBeCloseTo(RTP, 12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('(c) every eval config returns RTP within 4 SE', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const cfg of evalSpec.configs) {
      const rng = createRng(seededSource(700 + seed++));
      let sum = 0;
      let sum2 = 0;
      let max = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const m = evalSpec.playRound(cfg.params, rng).multiplier;
        sum += m;
        sum2 += m * m;
        max = Math.max(max, m);
      }
      const mean = sum / ROUNDS;
      const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
      rows.push(`${cfg.label.padEnd(36)} c one spin  rtp ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}% max ${max.toFixed(2)}`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(`rounds ${ROUNDS}\n${rows.join('\n')}`);
  });

  it('(d) a doubling progression and (e) a full hedge return RTP per unit staked within 4 SE', () => {
    const rows: string[] = [];
    const bases: [string, Layout, number][] = [
      ['red on 15', { ...EMPTY_LAYOUT, red: 1 }, 15],
      ['green on 37', { ...EMPTY_LAYOUT, green: 1 }, 37],
      ['edge + green on 55', { ...EMPTY_LAYOUT, edge: 1, green: 1 }, 55],
      ['e hedge: all four on 15', { red: 1, black: 1, green: 1, edge: 1 }, 15],
    ];
    let seed = 1;
    for (const [name, base, n] of bases) {
      const rng = createRng(seededSource(900 + seed++));
      let staked = 0;
      let dev = 0; // Σ (paid − RTP · stake): mean zero per spin whatever the stake
      let dev2 = 0;
      let spins = 0;
      while (spins < ROUNDS) {
        // One session: double after a loss, back to the base after a win.
        let f = 1;
        let net = 0;
        let losses = 0;
        while (net < 10 && losses < 12 && spins < ROUNDS) {
          const layout = scaleLayout(base, cents(totalOf(base) * f));
          const total = cents(totalOf(layout));
          const r = spin(layout, n, rng.next());
          const paid = r.multiplier * total;
          staked += total;
          dev += paid - RTP * total;
          dev2 += (paid - RTP * total) ** 2;
          net += paid - total;
          spins++;
          if (paid > total) (f = 1), (losses = 0);
          else (f *= 2), losses++;
        }
      }
      const rtp = RTP + dev / staked;
      const se = Math.sqrt(dev2) / staked;
      rows.push(`${name.padEnd(36)} d doubling  rtp ${(rtp * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}% over ${spins} spins`);
      expect(Math.abs(rtp - RTP)).toBeLessThan(4 * se + 1e-9);
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
