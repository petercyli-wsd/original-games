// Fairness audit: can any way of playing Sic Bo beat the RTP?
//
// Sic Bo is one event: chips go on the table, the dice are drawn after the
// stake is taken, and the layout is settled. There is no checkpoint, no
// cash-out and no decision once the dice are drawn (the table, chip value,
// undo, rebet, scale and clear are all disabled while rolling, and the roll
// settles the layout captured at Bet). So the tester's rule (a) and "take any
// profit" (b) collapse to (c) "play the round", and the only lever a player
// has is the layout itself. The questions:
//   - does rollDice draw each of the 216 ordered rolls with chance 1/216;
//   - does settle() pay exactly Σ stake · return (no rounding up);
//   - can any layout (hedges, coverage of the whole table, the best bets)
//     return more than the manifest RTP, the best single bet (Big / Small /
//     Odd / Even at 35/36)? By linearity a layout's return is the
//     stake-weighted mean of its bets', so no: the best layout is a best bet;
//   - does every eval config return its declared RTP?
// (d) the strongest we could think of: every one of the 52 bets alone, the
// best bets combined, full hedges (Big + Small, Odd + Even, all six singles,
// every total), the whole table at equal stakes, and 2,000 random layouts.

import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import { ALL_ROLLS, BETS, MAX_MULTIPLIER, RTP, betStats, dieOf, layoutRtp, layoutStats, returnOf, rollDice, settle, totalOf, type Layout } from './math';

/** Rounds per eval config; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** Exact return of a layout per unit staked, through the real settle() on all 216 rolls (each via rollDice). */
function exactReturn(l: Layout): number {
  let paid = 0;
  for (let a = 0; a < 6; a++)
    for (let b = 0; b < 6; b++)
      for (let c = 0; c < 6; c++) paid += settle(l, rollDice((a + 0.5) / 6, (b + 0.5) / 6, (c + 0.5) / 6)).paid;
  return paid / 216 / totalOf(l);
}

describe('Sic Bo fairness', () => {
  it('rollDice draws every ordered roll with chance exactly 1/216', () => {
    // Each die: u in [k/6, (k+1)/6) gives face k + 1, edges included.
    for (let k = 0; k < 6; k++) {
      expect(dieOf(k / 6)).toBe(k + 1);
      expect(dieOf((k + 1) / 6 - 1e-12)).toBe(k + 1);
      expect(dieOf((k + 0.5) / 6)).toBe(k + 1);
    }
    expect(dieOf(1 - 2 ** -32)).toBe(6);
    const seen = new Set<string>();
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) seen.add(rollDice((a + 0.5) / 6, (b + 0.5) / 6, (c + 0.5) / 6).join());
    expect(seen.size).toBe(216);
    expect([...seen].sort()).toEqual(ALL_ROLLS.map((d) => d.join()).sort());
  });

  it('no bet returns more than the manifest RTP, and the best ones return exactly it', () => {
    const best = Math.max(...BETS.map((b) => betStats(b.id).rtp));
    expect(best).toBe(RTP);
    expect(manifest.rtp).toBe(RTP);
    expect(RTP).toBeCloseTo(35 / 36, 15);
    for (const b of BETS) {
      // Through settle() and rollDice, not just returnOf.
      expect(exactReturn({ [b.id]: 1 })).toBeCloseTo(betStats(b.id).rtp, 12);
      expect(betStats(b.id).rtp).toBeLessThanOrEqual(RTP + 1e-15);
    }
    expect(BETS.filter((b) => Math.abs(betStats(b.id).rtp - RTP) < 1e-15).map((b) => b.id).sort()).toEqual(['big', 'even', 'odd', 'small']);
  });

  it('settle pays exactly Σ stake · return in cents: rounding never pays the player more', () => {
    const rng = createRng(seededSource(3));
    for (let n = 0; n < 3000; n++) {
      const l: Layout = {};
      const k = 1 + rng.int(6);
      for (let i = 0; i < k; i++) l[BETS[rng.int(BETS.length)].id] = (1 + rng.int(50_000)) / 100;
      const d = ALL_ROLLS[rng.int(216)];
      const cents = Object.entries(l).reduce((a, [id, s]) => a + Math.round(s * 100) * returnOf(BETS.find((b) => b.id === id)!, d), 0);
      const res = settle(l, d);
      expect(Math.round(res.paid * 100)).toBe(cents);
      expect(Math.abs(res.paid - cents / 100)).toBeLessThan(1e-9);
      expect(res.multiplier * totalOf(l)).toBeCloseTo(res.paid, 9);
      expect(res.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('(d) no layout beats the best bet: hedges, whole-table coverage and random layouts', () => {
    const named: Record<string, Layout> = {
      'best bets combined': { big: 1, small: 1, odd: 1, even: 1 },
      'Big + Small hedge': { big: 1, small: 1 },
      'Odd + Even hedge': { odd: 1, even: 1 },
      'hedge + any triple': { big: 1, small: 1, anyTriple: 0.07 },
      'all six singles': Object.fromEntries(BETS.filter((b) => b.kind === 'single').map((b) => [b.id, 1])),
      'every total': Object.fromEntries(BETS.filter((b) => b.kind === 'total').map((b) => [b.id, 1])),
      'whole table': Object.fromEntries(BETS.map((b) => [b.id, 1])),
      'all triples (highest variance)': Object.fromEntries(BETS.filter((b) => b.kind === 'triple').map((b) => [b.id, 1])),
    };
    for (const l of Object.values(named)) {
      const r = exactReturn(l);
      expect(r).toBeCloseTo(layoutRtp(l), 12);
      expect(r).toBeCloseTo(layoutStats(l).rtp, 12);
      expect(r).toBeLessThanOrEqual(RTP + 1e-12);
    }
    const rng = createRng(seededSource(8));
    let worst = -Infinity;
    for (let n = 0; n < 2000; n++) {
      const l: Layout = {};
      const k = 1 + rng.int(12);
      for (let i = 0; i < k; i++) l[BETS[rng.int(BETS.length)].id] = (1 + rng.int(2000)) / 100;
      const r = layoutStats(l);
      expect(r.rtp).toBeCloseTo(layoutRtp(l), 12);
      expect(r.maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
      worst = Math.max(worst, r.rtp - RTP);
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('(c) every eval config returns its declared exact RTP within 4 SE', () => {
    const rows: string[] = [];
    const reports = runEval(evalSpec, { rounds: ROUNDS, seed: 41 });
    reports.forEach((r, i) => {
      const target = configRtp(FAMILIES[i].layouts);
      expect(evalSpec.configs[i].rtp).toBe(target);
      expect(target).toBeLessThanOrEqual(RTP + 1e-12);
      const se = r.stdError;
      rows.push(`${r.label}: ${(r.rtp * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% vs ${(target * 100).toFixed(3)}% (z ${((r.rtp - target) / se).toFixed(2)})`);
      expect(Math.abs(r.rtp - target)).toBeLessThan(4 * se);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
