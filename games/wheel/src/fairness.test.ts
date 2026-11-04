// Fairness audit: can any way of playing Wheel beat the RTP?
//
// One spin per round: the segment is uniform on N, and the table's average
// multiplier is exactly 0.99 (integer identity in hundredths). There is no
// mid-round decision at all: Bet draws the segment and the wheel turns to it,
// with every control locked until it lands. So the tester's rule (a), take any
// profit (b) and play to the end (c) are all the same single spin; there is
// nothing to cash out mid-round. The only choices are between rounds:
// (d) the setting (15 risk × segment tables) and the stake sequence (Auto's
// on-win / on-loss changes, stop-on-profit / loss). Each spin is an
// independent bet worth exactly RTP × stake, so any stake sequence returns
// RTP of the total staked.
//
// Checks, with the game's own functions (tableFor, segmentFor, spin), and
// Game.tsx's landing angle:
//   - exact RTP on the host RNG's 2^-32 grid for all 15 tables (counting the
//     u's that map to each segment), within 1e-6 of 0.99;
//   - spin() pays the multiplier of the segment it draws, and the wheel's
//     final angle puts exactly that segment under the pointer (the paid
//     result is the shown one);
//   - every table by Monte Carlo through evalSpec.playRound and spin(), and a
//     doubling / stop-on-profit stake progression: RTP within 4 SE.
// The ticket reads only refs (spinning flag and resolved multiplier), both set
// synchronously in the same continuation as ticket.place(), so leaving at any
// point settles at the drawn result.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RISKS, RTP, SEGMENTS, segmentFor, spin, tableFor } from './math';

/** Rounds per config; the audit's heavy run sets FAIRNESS_ROUNDS (scratch fairness/run-heavy-*.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 50_000);
const ALL = RISKS.flatMap((risk) => SEGMENTS.map((n) => tableFor(risk, n)));

/** Game.tsx: the wheel angle that puts (index + offset) of a segment under the pointer, after `turns` full turns. */
function landingAngle(from: number, index: number, offset: number, n: number, turns: number): number {
  const s = 360 / n;
  const landAt = (index + offset) * s;
  const base = (((-landAt - from) % 360) + 360) % 360;
  return from + base + 360 * turns;
}
/** Game.tsx: the segment under the pointer at angle `deg`. */
const underPointer = (deg: number, n: number) => segmentFor((((-deg % 360) + 360) % 360) / 360, n);

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Wheel fairness', () => {
  it('exact RTP on the RNG grid: every table returns 0.99 to within 1e-6', () => {
    const G = 2 ** 32;
    for (const t of ALL) {
      const n = t.segments;
      let ev = 0;
      let total = 0;
      for (let i = 0; i < n; i++) {
        // u = j / 2^32 lands on segment i iff i ≤ j·n / 2^32 < i + 1 (exact in doubles: j·n < 2^38).
        const count = Math.ceil(((i + 1) * G) / n) - Math.ceil((i * G) / n);
        const lo = Math.ceil((i * G) / n);
        expect(segmentFor(lo / G, n)).toBe(i);
        if (lo > 0) expect(segmentFor((lo - 1) / G, n)).toBe(i - 1);
        total += count;
        ev += count * t.layout[i];
      }
      expect(total).toBe(G);
      expect(Math.abs(ev / G - RTP)).toBeLessThan(1e-6);
      expect(t.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });

  it('spin() pays the drawn segment, and the wheel stops with that segment under the pointer', () => {
    const rng = createRng(seededSource(5));
    for (let k = 0; k < 5_000; k++) {
      const t = ALL[rng.int(ALL.length)];
      const r = spin(() => rng.next(), t);
      expect(r.multiplier).toBe(t.layout[r.index]);
      expect(r.offset).toBeGreaterThanOrEqual(0.18);
      expect(r.offset).toBeLessThan(0.82);
      const from = (rng.next() - 0.5) * 7200;
      const target = landingAngle(from, r.index, r.offset, t.segments, rng.next() < 0.5 ? 5 : 2);
      expect(target).toBeGreaterThanOrEqual(from);
      expect(underPointer(target, t.segments)).toBe(r.index);
      expect(underPointer(((target % 360) + 360) % 360, t.segments)).toBe(r.index);
    }
  });

  it('no mid-round decision: (a)–(c) are one spin; (d) any table, through evalSpec and spin(): RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      const { mean, se, max } = mc((r) => evalSpec.playRound(cfg.params, r).multiplier, ROUNDS, 3300 + ci);
      rows.push(`${cfg.label.padEnd(40)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}×`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
    });
    // (d) every single table, including the 1-in-50 jackpot.
    ALL.forEach((t, ti) => {
      const { mean, se } = mc((r) => spin(() => r.next(), t).multiplier, ROUNDS / 5, 4400 + ti);
      rows.push(`${`${t.risk} ${t.segments}`.padEnd(40)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('(d) stake progressions between rounds (double after a loss, reset after a win, stop on profit) return RTP of the total staked', () => {
    const rng = createRng(seededSource(99));
    for (const t of [tableFor('low', 10), tableFor('medium', 30), tableFor('high', 50)]) {
      let staked = 0;
      let paid = 0;
      let paid2 = 0;
      for (let session = 0; session < ROUNDS / 20; session++) {
        let stake = 1;
        let profit = 0;
        for (let k = 0; k < 20 && profit < 5; k++) {
          const m = spin(() => rng.next(), t).multiplier;
          staked += stake;
          paid += stake * m;
          // Each spin's net (paid − RTP·stake) has mean 0; accumulate its variance.
          paid2 += (stake * m - RTP * stake) ** 2;
          profit += stake * m - stake;
          stake = m >= 1 ? 1 : Math.min(stake * 2, 1024);
        }
      }
      const se = Math.sqrt(paid2) / staked;
      expect(Math.abs(paid / staked - RTP)).toBeLessThan(4 * se + 1e-9);
    }
  });
});
