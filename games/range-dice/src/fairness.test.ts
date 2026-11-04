// Fairness audit: can any way of playing Range Dice beat the RTP?
//
// A bet is one roll: n = floor(u · 10000) with u = rng.next(), drawn right
// after the stake is accepted, paid 9900 / W on a win. Every control is
// disabled while rolling, Space only bets when idle, and Auto calls the same
// playOnce. There is no decision after the bet, so the tester's rule (a) and
// "take any profit" (b) collapse to (c), one roll per bet; the only freedom is
// the range, direction and staking.
//
// The host RNG returns j / 2^32 for a 32-bit j, so the true chance of each n
// is a count of grid points. The test finds those counts exactly with the real
// draw() (binary search on j; draw is monotone) and then checks the RTP of
// EVERY valid range and direction (all window positions and widths, In and
// Out) against 0.99: the most favourable is a +6e-7 relative grid artefact
// (and the least favourable −1.7e-6), both on W = 1. Every
// input path (handles, slide, flip, typed low/high, typed chance, typed
// multiplier, presets) is fuzzed to land on a valid range whose payout is
// 9900 / W. Monte Carlo per eval config with the host RNG: (c) the eval's
// sampled set-ups; (d1) the best grid pick (the single n with the most grid
// points, W = 1, 9900×), (d2) doubling after each loss at 49.5% (returned ÷
// staked). (d1) can't reach a 0.3% SE in any feasible run, so the exact grid
// count is the binding check there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  MAX_MULTIPLIER,
  MAX_WIN,
  MIN_WIN,
  PRESETS,
  RTP,
  SIZE,
  draw,
  flip,
  isValid,
  multiplierOf,
  playBet,
  setEnd,
  shift,
  winCount,
  winZones,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Range,
} from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const GRID = 2 ** 32;

/** Grid points j (u = j / 2^32) that the real draw() maps to each n, found by binary search. */
function gridCounts(): number[] {
  const first = (n: number) => {
    let lo = 0;
    let hi = GRID; // draw(hi / GRID) is never reached; treat as SIZE
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (draw(mid / GRID) >= n) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const starts = Array.from({ length: SIZE + 1 }, (_, n) => (n === SIZE ? GRID : first(n)));
  return Array.from({ length: SIZE }, (_, n) => starts[n + 1] - starts[n]);
}

function mc(f: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = f(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Range Dice fairness', () => {
  const counts = gridCounts();

  it('exact on the 2^32 grid: every range and direction returns RTP to within 2e-6 (relative), never more than +1e-6', () => {
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRID);
    const prefix = new Float64Array(SIZE + 1);
    for (let n = 0; n < SIZE; n++) prefix[n + 1] = prefix[n] + counts[n];
    let worst = 0;
    let best = { rtp: 0, w: 0, low: 0, dir: '' };
    for (let w = 1; w <= SIZE - 1; w++) {
      let mx = -Infinity;
      let mn = Infinity;
      let at = 0;
      for (let low = 0; low + w <= SIZE; low++) {
        const s = prefix[low + w] - prefix[low];
        if (s > mx) {
          mx = s;
          at = low;
        }
        if (s < mn) mn = s;
      }
      const cands: [number, number, string][] = [];
      if (w >= MIN_WIN && w <= MAX_WIN) cands.push([(mx / GRID) * (RTP * SIZE) / w, (mn / GRID) * (RTP * SIZE) / w, 'in']);
      const W = SIZE - w;
      if (W >= MIN_WIN && W <= MAX_WIN) cands.push([((GRID - mn) / GRID) * (RTP * SIZE) / W, ((GRID - mx) / GRID) * (RTP * SIZE) / W, 'out']);
      for (const [hi, lo, dir] of cands) {
        worst = Math.max(worst, Math.abs(hi / RTP - 1), Math.abs(lo / RTP - 1));
        if (hi > best.rtp) best = { rtp: hi, w, low: at, dir };
      }
    }
    // Worst case either way is W = 1: a single n has 429,496 or 429,497 of the
    // 429,496.73 grid points it should, so −1.7e-6 or +6.3e-7 relative.
    expect(worst).toBeLessThan(2e-6);
    // The most favourable pick on the grid (a single n with 429,497 points): +6e-7.
    expect(best.rtp).toBeLessThan(RTP * (1 + 1e-6));
  });

  it('every input path lands on a valid range whose payout is 9900 / W and whose green length is W', () => {
    const rng = createRng(seededSource(3301));
    let r: Range = { low: 2525, high: 7474, dir: 'in' };
    const bad: Range[] = [];
    for (let i = 0; i < 50_000; i++) {
      const op = rng.int(7);
      if (op === 0) r = setEnd(r, 'low', rng.int(SIZE + 200) - 100);
      else if (op === 1) r = setEnd(r, 'high', rng.int(SIZE + 200) - 100);
      else if (op === 2) r = shift(r, rng.int(SIZE + 200) - 100);
      else if (op === 3) r = flip(r);
      else if (op === 4) r = withWins(r, winsForChance(rng.next() * 120 - 10));
      else if (op === 5) r = withWins(r, winsForMultiplier(0.5 + rng.next() * 12000));
      else r = withWins(r, winsForMultiplier(PRESETS[rng.int(PRESETS.length)]));
      const W = winCount(r);
      const ok =
        isValid(r) &&
        multiplierOf(r) === (RTP * SIZE) / W &&
        multiplierOf(r) <= MAX_MULTIPLIER &&
        winZones(r).reduce((a, [f, t]) => a + t - f, 0) === W;
      if (!ok) bad.push(r);
    }
    expect(bad).toEqual([]);
  });

  it('strategies (c)/(d) on every eval config return RTP within 4 SE with the host RNG', () => {
    const rows: string[] = [];
    // (c): the eval's sampled set-ups, one roll per bet. (a) and (b) collapse to this: no decision after the bet.
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const res = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 4100 + ci);
      rows.push(`${label} | (c) one roll per bet | ${(res.mean * 100).toFixed(3)}% ± ${(res.se * 100).toFixed(3)}% | max ${res.max.toFixed(2)}`);
      expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
      expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    });
    // (d1) the best grid pick: In on the single n with the most grid points.
    const bestN = counts.indexOf(Math.max(...counts));
    const d1 = mc((rng) => playBet({ low: bestN, high: bestN, dir: 'in' }, rng.next()).multiplier, ROUNDS, 4200);
    rows.push(`(d1) In [${bestN}, ${bestN}] (W = 1) | ${(d1.mean * 100).toFixed(3)}% ± ${(d1.se * 100).toFixed(3)}%`);
    expect(Math.abs(d1.mean - RTP)).toBeLessThan(4 * d1.se + 1e-12);
    // (d2) doubling after each loss on In [2525, 7474] (49.5%), reset after a win or at 2^10: returned ÷ staked.
    const r: Range = { low: 2525, high: 7474, dir: 'in' };
    const rng = createRng(seededSource(4300));
    let staked = 0;
    let back = 0;
    let stake = 1;
    const per: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const m = playBet(r, rng.next()).multiplier;
      staked += stake;
      back += stake * m;
      per.push(stake * (m - RTP));
      stake = m > 0 || stake >= 1024 ? 1 : stake * 2;
    }
    const ratio = back / staked;
    const se = Math.sqrt(per.reduce((a, x) => a + x * x, 0) / ROUNDS) / (staked / Math.sqrt(ROUNDS));
    rows.push(`(d2) doubling at 49.5% | ${(ratio * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%`);
    expect(Math.abs(ratio - RTP)).toBeLessThan(4 * se);
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
