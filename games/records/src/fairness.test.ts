// Fairness audit: can any way of playing Records beat the RTP?
//
// The target k is locked at the bet (the slider is disabled while live). Bet
// drops item 1 at once (always a record, rank 1 of 1); after that, at every
// checkpoint the player either cashes out at prize × P(win | j, r) or drops
// the next item. Each item's slot is drawn with the host RNG the moment it
// starts to fall (1 + rng.int(t)), never in advance. The round ends at once on
// k records (prize) or when too few items remain (0). So the only decision is
// when to stop, and the state is (j items seen, r records).
//
// Martingale check: at every reachable state (all of them, for every k) the
// next event has two outcomes, record with chance 1/(j+1) or not, so
// E[V after] is enumerated exactly. The record chance of the real drawRank is
// also checked by Monte Carlo (100k+ draws, 4 SE), and the tail table behind
// the prices is checked against an independent Poisson-binomial convolution
// and, at the start, against Stirling numbers of the first kind (BigInt).
//
// Strategies (stopping rules on (j, r)), per eval config: (a) the tester's:
// go on only while the next item can't end the round lost with chance > 20%,
// else cash out; (b) cash out the moment the value exceeds the stake;
// (c) drop every item; (d1) lock in after any record that puts the value
// above the stake, and stop-loss once the value falls below half the stake;
// (d2) cash out whenever the next item's record chance is under 1 in 6 while
// records are still needed (the "momentum" rule); (d3) the exact
// highest-value stopping rule found by backward induction (it can't exceed
// RTP: the max over stop/continue of a martingale is the martingale). Each
// rule is valued exactly by backward induction, and (a)–(d2) are also played
// as Monte Carlo rounds with the host RNG. On k = 9 a full win pays ~800×, so its Monte
// Carlo can't reach 0.3% SE; the exact value is the binding check there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_MULTIPLIER, N, RTP, TARGETS, drawRank, headline, isRecord, outOfReach, prizeFor, recordChance, tailTable, winChance } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** Cash out at (k, j, r)? Called only at live checkpoints (j ≥ 1, not decided). */
type Stop = (k: number, j: number, r: number) => boolean;

const value = (k: number, j: number, r: number) => prizeFor(k) * winChance(k, j, r);
/** The post-item payout as Game.tsx settles it: prize on k records, 0 when out of reach, else null (checkpoint). */
const terminal = (k: number, j: number, r: number) => (r >= k ? prizeFor(k) : outOfReach(k, j, r) ? 0 : null);

const STRATEGIES: { name: string; stop: Stop }[] = [
  {
    name: '(a) tester: go on while P(next item ends it lost) ≤ 20%',
    stop: (k, j, r) => {
      const lose = outOfReach(k, j + 1, r) ? 1 - recordChance(j + 1) : 0;
      return 1 - lose < 0.8;
    },
  },
  { name: '(b) cash out the moment value > stake', stop: (k, j, r) => value(k, j, r) > 1 },
  { name: '(c) drop every item', stop: () => false },
  { name: '(d1) lock in above stake, stop-loss below half', stop: (k, j, r) => value(k, j, r) > 1 || value(k, j, r) < 0.5 },
  { name: '(d2) stop when the next record chance < 1/6', stop: (_k, j) => recordChance(j + 1) < 1 / 6 },
];

/** Exact value of a stopping rule from the start (backward induction over (j, r)). */
function exactValue(k: number, stop: Stop): number {
  const memo = new Map<number, number>();
  const go = (j: number, r: number): number => {
    const t = terminal(k, j, r);
    if (t !== null) return t;
    if (j >= 1 && stop(k, j, r)) return value(k, j, r);
    const key = j * 64 + r;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const p = recordChance(j + 1);
    const v = p * go(j + 1, r + 1) + (1 - p) * go(j + 1, r);
    memo.set(key, v);
    return v;
  };
  return go(0, 0);
}

/** The best any stopping rule can do (optimal stopping by backward induction). */
function optimalValue(k: number): number {
  const memo = new Map<number, number>();
  const go = (j: number, r: number): number => {
    const t = terminal(k, j, r);
    if (t !== null) return t;
    const key = j * 64 + r;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const p = recordChance(j + 1);
    const cont = p * go(j + 1, r + 1) + (1 - p) * go(j + 1, r);
    const v = j >= 1 ? Math.max(cont, value(k, j, r)) : cont;
    memo.set(key, v);
    return v;
  };
  return go(0, 0);
}

/** One round as Game.tsx plays it: item 1 dropped at the bet, then a checkpoint after each item. */
function playRound(k: number, stop: Stop, rng: Rng): number {
  let j = 0;
  let r = 0;
  for (;;) {
    j++;
    if (isRecord(drawRank(j, rng), j)) r++;
    const t = terminal(k, j, r);
    if (t !== null) return t;
    if (stop(k, j, r)) return value(k, j, r);
  }
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

describe('Records fairness', () => {
  it('martingale (exact): at every reachable state, E[value after the next item] = value now', () => {
    let states = 0;
    for (const k of TARGETS) {
      const prize = prizeFor(k);
      for (let j = 0; j < N; j++)
        for (let r = j === 0 ? 0 : 1; r <= j; r++) {
          if (j > 0 && terminal(k, j, r) !== null) continue;
          states++;
          const p = recordChance(j + 1);
          const after = (r2: number) => terminal(k, j + 1, r2) ?? value(k, j + 1, r2);
          const v = j === 0 ? RTP : value(k, j, r);
          expect(Math.abs(p * after(r + 1) + (1 - p) * after(r) - v)).toBeLessThan(1e-12 * prize);
          // The price shown is the prize times the chance: P(win | state) ≤ 1, so no state pays above the prize.
          expect(v).toBeLessThanOrEqual(prize * (1 + 1e-12));
        }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the tail table matches an independent Poisson-binomial convolution, and Stirling numbers at the start', () => {
    // Independent: distribution of the records among items j+1..N by convolution.
    const t = tailTable(N);
    for (let j = 0; j <= N; j++) {
      let dist = [1];
      for (let i = j + 1; i <= N; i++) {
        const p = 1 / i;
        const next = new Array(dist.length + 1).fill(0);
        dist.forEach((q, m) => {
          next[m] += q * (1 - p);
          next[m + 1] += q * p;
        });
        dist = next;
      }
      for (let d = 0; d <= N + 1; d++) {
        const tail = dist.slice(Math.max(0, d)).reduce((a, b) => a + b, 0);
        expect(Math.abs(t[j][d] - tail)).toBeLessThan(1e-14);
      }
    }
    // Start: P(≥ k records) = Σ_{m≥k} c(N, m) / N!, unsigned Stirling numbers of the first kind.
    let c: bigint[] = [1n];
    for (let n = 1; n <= N; n++) {
      const nx: bigint[] = new Array(n + 1).fill(0n);
      for (let m = 0; m < c.length; m++) {
        nx[m + 1] += c[m];
        nx[m] += BigInt(n - 1) * c[m];
      }
      c = nx;
    }
    const fact = c.reduce((a, b) => a + b, 0n);
    for (const k of TARGETS) {
      const num = c.slice(k).reduce((a, b) => a + b, 0n);
      expect(Math.abs(headline(k) - Number(num) / Number(fact))).toBeLessThan(1e-14);
    }
  });

  it('the real drawRank makes item t a record with chance 1/t (100k draws per t, 4 SE)', () => {
    const rng = createRng(seededSource(5501));
    const draws = 100_000;
    for (let t = 1; t <= N; t++) {
      let rec = 0;
      let bad = 0;
      for (let i = 0; i < draws; i++) {
        const rank = drawRank(t, rng);
        if (!(Number.isInteger(rank) && rank >= 1 && rank <= t)) bad++;
        if (isRecord(rank, t)) rec++;
      }
      expect(bad).toBe(0);
      const p = recordChance(t);
      expect(Math.abs(rec / draws - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / draws) + 1e-12);
    }
  });

  it('every stopping rule is worth exactly RTP, and the optimal one is no better', () => {
    for (const k of TARGETS) {
      for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(k, stop) - RTP)).toBeLessThan(1e-12);
      expect(optimalValue(k)).toBeLessThan(RTP + 1e-12);
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE with the host RNG, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const res = mc((rng) => playRound(params.k, stop, rng), ROUNDS, 8100 + 17 * ci + si);
        rows.push(`${label} | ${name} | ${(res.mean * 100).toFixed(3)}% ± ${(res.se * 100).toFixed(3)}% | max ${res.max.toFixed(2)}`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
