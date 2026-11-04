// Fairness audit: can any way of playing Gossip beat the RTP?
//
// The tester's claim: "keep spreading only when the next round is ≥ 80% safe,
// cash out otherwise, and you come out ahead." The only decision in a round is
// when to stop: the network size and round budget are locked while live (the
// prize is locked in the round at the bet). So the claim fails exactly when
// the cash-out is a martingale over each round of calls. By symmetry the
// informed count i with r rounds left is the whole state.
//
//   - Martingale, exact: at every live state (i, r) of every offered setting,
//     E[cash-out after a round] is summed over the occupancy closed form
//     (BigInt, independent of the pricing recursion), with the cash-out
//     computed exactly as Game.tsx's spread() does.
//   - Martingale, real process: at 30+ states reached by playing the real
//     playRound, 100k further rounds of the real playRound each; the mean
//     cash-out after must be within 4 SE of the cash-out now.
//   - Strategies, per eval config: (a) the tester's 80% rule, (b) take any
//     profit, (c) play to the end, (d) quit at the mop-up phase (more than
//     half know, where most calls are wasted) unless behind, and bail when
//     the next round can put everyone out of reach more than 10% of the time;
//     each computed exactly by recursion over the occupancy law and by Monte
//     Carlo through playRound (4 SE); plus the Snell envelope (optimal
//     stopping, the best any rule can do).
//
// FAIRNESS_ROUNDS sets the Monte Carlo rounds (the audit's heavy run uses 200k).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BUDGETS, RTP, SIZES, countOf, deadChance, occupancy, playRound, prizeFor, spreadTable, startInformed, winChance, type Size } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 8_000);
const SAMPLES = Number(import.meta.env.FAIRNESS_SAMPLES ?? 100_000);

interface Setting {
  n: Size;
  R: number;
}

/** The cash-out after a round, exactly as Game.tsx's spread() computes it. */
function cashAfter({ n, R }: Setting, i: number, left: number): number {
  const prize = prizeFor(n, R);
  return i >= n ? prize : prize * winChance(n, i, left);
}
const over = (s: Setting, i: number, left: number) => i >= s.n || cashAfter(s, i, left) <= 0;

/** Chance the next round does not end the round lost (from the pricing table). */
function survival(s: Setting, i: number, left: number): number {
  const d = spreadTable(s.n)[i];
  let p = 0;
  for (let k = 0; k < d.length; k++) if (cashAfter(s, i + k, left - 1) > 0) p += d[k];
  return p;
}

interface View {
  s: Setting;
  i: number;
  left: number;
  cash: number;
}
type Stop = (v: View) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) continue only if next round ≥ 80% safe', stop: (v) => survival(v.s, v.i, v.left) < 0.8 },
  { name: '(b) take any profit', stop: (v) => v.cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  {
    name: '(d) quit at mop-up unless behind; bail if next round ≥ 10% fatal',
    stop: (v) => deadChance(v.s.n, v.i, v.left) > 0.1 || (v.cash >= 1 && v.i * 2 > v.s.n),
  },
];

/** Exact value of a stopping rule from a checkpoint (i informed, left rounds left), memoised by state. */
function exact(s: Setting, i: number, left: number, stop: Stop | 'snell', memo: Map<number, number>): number {
  const key = i * 64 + left;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const cash = cashAfter(s, i, left);
  let v: number;
  if (over(s, i, left)) v = cash;
  else {
    const d = spreadTable(s.n)[i];
    let cont = 0;
    for (let k = 0; k < d.length; k++) if (d[k] > 0) cont += d[k] * exact(s, i + k, left - 1, stop, memo);
    v = stop === 'snell' ? Math.max(cash, cont) : stop({ s, i, left, cash }) ? cash : cont;
  }
  memo.set(key, v);
  return v;
}

/** The value of a round from the bet (the bet runs round 1, no decision before it). */
function exactRound(s: Setting, stop: Stop | 'snell'): number {
  const memo = new Map<number, number>();
  const d = spreadTable(s.n)[1];
  let v = 0;
  for (let k = 0; k < d.length; k++) if (d[k] > 0) v += d[k] * exact(s, 1 + k, s.R - 1, stop, memo);
  return v;
}

const occCache = new Map<string, number>();
function occ(n: number, i: number, k: number): number {
  const key = `${n}|${i}|${k}`;
  let v = occCache.get(key);
  if (v === undefined) occCache.set(key, (v = occupancy(n, i, k)));
  return v;
}

/** One round through the real process, as Game.tsx plays it. */
function play(s: Setting, stop: Stop, rng: Rng): number {
  let informed = startInformed(s.n);
  for (let t = 1; ; t++) {
    informed = playRound(s.n, informed, rng).informed;
    const i = countOf(informed);
    const left = s.R - t;
    const cash = cashAfter(s, i, left);
    if (over(s, i, left)) return cash;
    if (stop({ s, i, left, cash })) return cash;
  }
}

function mc(play1: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play1(rng);
    sum += x;
    s2 += x * x;
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const SETTINGS: Setting[] = SIZES.flatMap((n) => Array.from({ length: BUDGETS[n].max - BUDGETS[n].min + 1 }, (_, j) => ({ n, R: BUDGETS[n].min + j })));
const CONFIGS = evalSpec.configs.map((c) => c.params as Setting);

describe('Gossip fairness', () => {
  it('martingale, exact: every live state of every setting, next round summed over the occupancy closed form', () => {
    let states = 0;
    let worst = 0;
    for (const s of SETTINGS) {
      for (let left = 1; left < s.R; left++) {
        for (let i = 1; i < s.n; i++) {
          if (over(s, i, left)) continue;
          let ev = 0;
          for (let k = 0; k <= s.n - i; k++) ev += occ(s.n, i, k) *cashAfter(s, i + k, left - 1);
          worst = Math.max(worst, Math.abs(ev / cashAfter(s, i, left) - 1));
          states++;
        }
      }
    }
    expect(states).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-9);
  });

  it(`martingale, real process: 30+ reached states, ${SAMPLES} real rounds each, within 4 SE`, () => {
    const rng = createRng(seededSource(4242));
    const picked: { s: Setting; informed: boolean[]; left: number }[] = [];
    while (picked.length < 30) {
      const s = SETTINGS[rng.int(SETTINGS.length)];
      // Stop at a random round, every third pick at the last checkpoint (one round left).
      const target = picked.length % 3 === 0 ? s.R - 1 : 1 + rng.int(s.R - 1);
      let informed = startInformed(s.n);
      for (let t = 1; t <= target; t++) {
        informed = playRound(s.n, informed, rng).informed;
        const left = s.R - t;
        if (over(s, countOf(informed), left)) break;
        if (t === target) picked.push({ s, informed, left });
      }
    }
    let lateStates = 0;
    for (const { s, informed, left } of picked) {
      const now = cashAfter(s, countOf(informed), left);
      let sum = 0;
      for (let j = 0; j < SAMPLES; j++) sum += cashAfter(s, countOf(playRound(s.n, informed, rng).informed), left - 1);
      const mean = sum / SAMPLES;
      // SE from the exact variance of the next cash-out (occupancy law): the
      // sample variance collapses to 0 when a rare win never shows up.
      const i = countOf(informed);
      let m2 = 0;
      for (let k = 0; k <= s.n - i; k++) m2 += occ(s.n, i, k) * cashAfter(s, i + k, left - 1) ** 2;
      const se = Math.sqrt(Math.max(0, m2 - now * now) / SAMPLES);
      expect(Math.abs(mean - now)).toBeLessThan(4 * se + 1e-12);
      if (left === 1) lateStates++;
    }
    expect(lateStates).toBeGreaterThan(0);
  });

  it('every strategy and optimal stopping, computed exactly over every setting, return RTP', () => {
    for (const s of SETTINGS) {
      for (const { stop } of STRATEGIES) expect(exactRound(s, stop)).toBeCloseTo(RTP, 10);
      expect(exactRound(s, 'snell')).toBeCloseTo(RTP, 10);
      // The board's "out of reach next round" share is the true chance of a dead round.
      for (let left = 1; left < s.R; left++) {
        for (let i = 1; i < s.n; i++) if (!over(s, i, left)) expect(1 - deadChance(s.n, i, left)).toBeCloseTo(survival(s, i, left), 12);
      }
    }
  });

  it(`adversarial strategies by Monte Carlo (${ROUNDS} rounds each) are within 4 SE of RTP`, () => {
    const rows: string[] = [];
    let seed = 1300;
    for (const s of CONFIGS) {
      const cells: string[] = [];
      for (const { stop } of STRATEGIES) {
        const r = mc((rng) => play(s, stop, rng), ROUNDS, seed++);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        cells.push(`${(r.mean * 100).toFixed(2)} ± ${(r.se * 100).toFixed(2)}`);
      }
      rows.push(`${s.n} nodes ${s.R} rounds: ${cells.join(' | ')}`);
    }
    console.log(`Gossip RTP % (${ROUNDS} rounds) — ${STRATEGIES.map((x) => x.name).join(' | ')}\n${rows.join('\n')}`);
  });
});
