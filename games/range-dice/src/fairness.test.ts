// Fairness audit: can any way of playing Range Dice beat the RTP?
//
// A bet is one roll: n = floor(u · 10000) with u = rng.next(), drawn right
// after the stake is accepted, paid 9900 / W on a win. Every control is
// disabled while rolling, Space only bets when idle, and Auto calls the same
// playOnce. There is no cash-out and no decision after the bet, so the
// martingale and "take any profit" / "play to the end" strategies collapse to
// one roll per bet; the only freedom is the set-up (mode, ranges) and staking.
//
// The host RNG returns j / 2^32 for a 32-bit j, so the true chance of each n
// is a count of grid points. The test finds those counts exactly with the real
// draw() (binary search on j; draw is monotone). Any set-up in any mode is a
// set of W numbers, so the most and least favourable of ALL W-number sets are
// the W largest and W smallest counts: checking those for every W from 1 to
// 9800 covers every range, mode and position. Every input path (handles,
// slide, mode change, typed low/high, typed chance, typed multiplier) is
// fuzzed to land on a valid set-up whose payout is 9900 / W. Monte Carlo per
// eval config with the host RNG covers the sampled set-ups, the best single
// number and a doubling-after-loss staking plan.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  DEFAULT_CONFIG,
  ENDS,
  MAX_MULTIPLIER,
  MAX_WIN,
  RTP,
  SIZE,
  draw,
  isValid,
  maxMultiplierOf,
  multiplierOf,
  playBet,
  setEnd,
  setMode,
  shift,
  winCount,
  winLimits,
  winZones,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Config,
  type Mode,
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

  it('exact on the 2^32 grid: any W numbers return RTP to within 2e-6 (relative), never more than +1e-6', () => {
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRID);
    const asc = [...counts].sort((a, b) => a - b);
    const desc = [...asc].reverse();
    let hi = 0;
    let lo = 0;
    let best = 0;
    for (let w = 1; w <= MAX_WIN; w++) {
      hi += desc[w - 1];
      lo += asc[w - 1];
      const m = (RTP * SIZE) / w;
      best = Math.max(best, (hi / GRID) * m);
      expect(Math.abs((hi / GRID) * m / RTP - 1)).toBeLessThan(2e-6);
      expect(Math.abs((lo / GRID) * m / RTP - 1)).toBeLessThan(2e-6);
    }
    expect(best).toBeLessThan(RTP * (1 + 1e-6));
  });

  it('every input path lands on a valid set-up whose payout is 9900 / W and whose green length is W', () => {
    const rng = createRng(seededSource(3301));
    const modes: Mode[] = ['in', 'out', 'two'];
    let r: Config = DEFAULT_CONFIG;
    const bad: Config[] = [];
    for (let i = 0; i < 60_000; i++) {
      const op = rng.int(8);
      if (op === 0) r = setEnd(r, ENDS[r.mode][rng.int(ENDS[r.mode].length)], rng.int(SIZE + 200) - 100);
      else if (op === 1) r = setEnd(r, 'low', rng.int(SIZE + 200) - 100);
      else if (op === 2) r = shift(r, rng.int(2) as 0 | 1, rng.int(SIZE + 200) - 100);
      else if (op === 3) r = setMode(r, modes[rng.int(3)]);
      else if (op === 4) r = withWins(r, winsForChance(r.mode, rng.next() * 120 - 10));
      else if (op === 5) r = withWins(r, winsForMultiplier(r.mode, 0.5 + rng.next() * 12000));
      else if (op === 6) r = withWins(r, winsForMultiplier(r.mode, 1.0102 + rng.next() * 3));
      else r = setEnd(r, 'high', rng.int(SIZE + 200) - 100);
      const W = winCount(r);
      const [minW, maxW] = winLimits(r.mode);
      const ok =
        isValid(r) &&
        W >= minW &&
        W <= maxW &&
        multiplierOf(r) === (RTP * SIZE) / W &&
        multiplierOf(r) <= maxMultiplierOf(r.mode) &&
        multiplierOf(r) <= MAX_MULTIPLIER &&
        winZones(r).reduce((a, [f, t]) => a + t - f, 0) === W;
      if (!ok) bad.push(r);
    }
    expect(bad).toEqual([]);
  });

  it('strategies on every eval config return RTP within 4 SE with the host RNG', () => {
    const rows: string[] = [];
    // (c): the eval's sampled set-ups, one roll per bet.
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const res = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 4100 + ci);
      rows.push(`${label} | one roll per bet | ${(res.mean * 100).toFixed(3)}% ± ${(res.se * 100).toFixed(3)}% | max ${res.max.toFixed(2)}`);
      expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
      expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    });
    // (d1) the best grid pick: Roll in on the single n with the most grid points.
    const bestN = counts.indexOf(Math.max(...counts));
    const one: Config = { ...DEFAULT_CONFIG, mode: 'in', low: bestN, high: bestN };
    const d1 = mc((rng) => playBet(one, rng.next()).multiplier, ROUNDS, 4200);
    rows.push(`(d1) In [${bestN}] (W = 1) | ${(d1.mean * 100).toFixed(3)}% ± ${(d1.se * 100).toFixed(3)}%`);
    expect(Math.abs(d1.mean - RTP)).toBeLessThan(4 * d1.se + 1e-12);
    // (d2) doubling after each loss on Roll between two (~49.5%), reset after a win or at 2^10.
    const r: Config = { mode: 'two', low: 1000, high: 3474, low2: 6000, high2: 8474 };
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
