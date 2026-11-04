// Fairness audit: can any way of playing Tally beat the RTP?
//
// Each ball lands at u = rng.next() along the floor and falls into the bin
// under it (landing(u)); the first bin to stack 3 wins. Bet drops the first
// ball at once; at each checkpoint after it the player may drop the next ball,
// cash out, or switch to another bin (the cash-out is kept and the prize
// relocks at cash / P(new bin first); a relock above MAX_WIN is refused).
// Auto plays the same balls with a "cash out at ×N" stopping rule. So the
// claim "cash out whenever the next ball looks bad" (or "switch to the right
// bin at the right time") fails exactly when, at every live state and for
// every bin the player could back there, averaging the post-ball value over
// the five landings (weighted by bin width) returns the cash-out now, and the
// switch itself leaves the cash-out unchanged. Both are checked below at
// states reached by random rounds, including states two balls from the end.
//
// Strategies, per eval config (the bin backed at the bet):
//   (a) the tester's: drop while the next ball is ≥ 80% safe (it does not
//       complete a rival's stack), else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end;
//   (d) long-shot switcher: at every checkpoint switch to the least likely bin
//       the cap allows (highest variance), play to the end;
//   (e) favourite switcher: switch to the most likely bin, cash out above 1×;
//   (f) Auto "cash out at 3×".
// Every rule is also valued exactly over the (stacks, bin, prize) states, the
// binding check for the 5% bin (a 207× shot whose Monte Carlo needs tens of
// millions of rounds for a 0.3% standard error).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BINS, HEIGHT, MAX_WIN, RTP, SHARE, UNITS, WIDTHS, emptyStacks, firstChances, landing, relock, startPrize, winChance } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

interface Live {
  stacks: number[];
  mine: number;
  prize: number;
}
const cashOf = (s: Live) => s.prize * winChance(s.stacks, s.mine);

/** At a checkpoint: optionally switch (returns the new state), then decide. */
interface Strategy {
  switchTo?: (s: Live) => number | null;
  /** True = cash out now. */
  stop: (s: Live) => boolean;
}

/** Chance the next ball does not complete a rival's stack. */
const safeNext = (s: Live) => 1 - s.stacks.reduce((a, c, j) => a + (j !== s.mine && c === HEIGHT - 1 ? SHARE[j] : 0), 0);

const byChance = (s: Live, pickMax: boolean) => {
  let best: number | null = null;
  let bestP = pickMax ? -1 : Infinity;
  const ps = firstChances(s.stacks);
  const cash = s.prize * ps[s.mine];
  for (let i = 0; i < BINS; i++) {
    const p = ps[i];
    // relock() refuses exactly these (it is still what applySwitch calls).
    if (!(p > 0) || cash / p > MAX_WIN) continue;
    if (pickMax ? p > bestP : p < bestP) (best = i), (bestP = p);
  }
  return best;
};

const STRATEGIES: Record<string, Strategy> = {
  'a tester (drop only if ≥ 80% safe)': { stop: (s) => safeNext(s) < 0.8 },
  'b take any profit': { stop: (s) => cashOf(s) > 1 },
  'c play to the end': { stop: () => false },
  'd long-shot switcher': { switchTo: (s) => byChance(s, false), stop: () => false },
  'e favourite switcher, cash > 1×': { switchTo: (s) => byChance(s, true), stop: (s) => cashOf(s) > 1 },
  'f auto cash at 3×': { stop: (s) => cashOf(s) >= 3 - 1e-12 },
};

/** Applies a switch as Game.tsx's switchTo does: keep the cash-out, relock, refuse above MAX_WIN. */
function applySwitch(s: Live, to: number | null | undefined): Live {
  if (to === null || to === undefined || to === s.mine) return s;
  const prize = relock(cashOf(s), s.stacks, to);
  return prize === null ? s : { ...s, mine: to, prize };
}

/** One round as Game.tsx plays it; returns the settled multiplier. */
function playRound(mine: number, strat: Strategy, rng: Rng): number {
  let s: Live = { stacks: emptyStacks(), mine, prize: startPrize(mine) };
  for (let ball = 0; ; ball++) {
    if (ball > 0) {
      s = applySwitch(s, strat.switchTo?.(s));
      if (strat.stop(s)) return cashOf(s);
    }
    const j = landing(rng.next());
    const stacks = s.stacks.slice();
    stacks[j]++;
    if (stacks[j] >= HEIGHT) return j === s.mine ? s.prize : 0;
    s = { ...s, stacks };
  }
}

/** Exact value of a strategy: sum over the five landings of every ball. */
const exactCache = new Map<string, number>();
function exactValue(mine: number, strat: Strategy): number {
  const id = `${mine}/${Object.values(STRATEGIES).indexOf(strat)}`;
  let v = exactCache.get(id);
  if (v === undefined) exactCache.set(id, (v = exactValueUncached(mine, strat)));
  return v;
}

function exactValueUncached(mine: number, strat: Strategy): number {
  const memo = new Map<string, number>();
  const go = (s: Live, first: boolean): number => {
    const key = `${s.stacks.join('')}/${s.mine}/${s.prize.toPrecision(15)}/${first}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = step(s, first);
    memo.set(key, v);
    return v;
  };
  const step = (s: Live, first: boolean): number => {
    if (!first) {
      s = applySwitch(s, strat.switchTo?.(s));
      if (strat.stop(s)) return cashOf(s);
    }
    let v = 0;
    for (let j = 0; j < BINS; j++) {
      const stacks = s.stacks.slice();
      stacks[j]++;
      v += SHARE[j] * (stacks[j] >= HEIGHT ? (j === s.mine ? s.prize : 0) : go({ ...s, stacks }, false));
    }
    return v;
  };
  return go({ stacks: emptyStacks(), mine, prize: startPrize(mine) }, true);
}

/** Live checkpoint states from random rounds (random bin, random switches, random depth). */
function sampleStates(rng: Rng, count: number): Live[] {
  const out: Live[] = [];
  while (out.length < count) {
    const mine = rng.int(BINS);
    let s: Live = { stacks: emptyStacks(), mine, prize: startPrize(mine) };
    const depth = 3 + rng.int(8);
    for (let b = 0; b < depth; b++) {
      const j = landing(rng.next());
      const stacks = s.stacks.slice();
      stacks[j]++;
      if (stacks[j] >= HEIGHT) break;
      s = applySwitch({ ...s, stacks }, rng.next() < 0.3 ? rng.int(BINS) : null);
      out.push(s);
    }
  }
  return out;
}

describe('Tally fairness', () => {
  it('a ball lands in each bin with exactly its width (tie rule: left edge belongs to the bin)', () => {
    const N = UNITS * 1000;
    const hits = new Array<number>(BINS).fill(0);
    for (let k = 0; k < N; k++) hits[landing(k / N)]++;
    WIDTHS.forEach((w, j) => expect(hits[j]).toBe(w * 1000));
    expect(landing(0.999999999999)).toBe(BINS - 1);
  });

  it('martingale: for every bin the player could back, the width-weighted next ball returns the cash-out now', () => {
    const rng = createRng(seededSource(91));
    const states = sampleStates(rng, 1500);
    let checked = 0;
    let late = 0;
    for (const s0 of states) {
      const cash = cashOf(s0);
      for (let i = 0; i < BINS; i++) {
        const s = applySwitch(s0, i);
        // A switch keeps the value (or is refused, leaving the state as it was).
        expect(Math.abs(cashOf(s) - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        expect(s.prize).toBeLessThanOrEqual(MAX_WIN);
        let ev = 0;
        for (let j = 0; j < BINS; j++) {
          const stacks = s.stacks.slice();
          stacks[j]++;
          ev += SHARE[j] * (stacks[j] >= HEIGHT ? (j === s.mine ? s.prize : 0) : s.prize * winChance(stacks, s.mine));
        }
        expect(Math.abs(ev - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        checked++;
      }
      // Late: at most five balls from the longest possible end, a rival one ball from winning.
      if (s0.stacks.reduce((x, y) => x + y, 0) >= 6 && s0.stacks.some((c, j) => c === HEIGHT - 1 && j !== s0.mine)) late++;
    }
    expect(checked).toBeGreaterThanOrEqual(BINS * 30);
    expect(late).toBeGreaterThanOrEqual(30);
  });

  it('every strategy is worth exactly RTP (exact sums over the landings)', () => {
    for (const cfg of evalSpec.configs) {
      for (const strat of Object.values(STRATEGIES)) expect(exactValue(cfg.params.mine, strat)).toBeCloseTo(RTP, 10);
    }
  });

  it('every strategy played ball by ball returns RTP within 4 SE', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const cfg of evalSpec.configs) {
      for (const [name, strat] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(9000 + seed++));
        let sum = 0;
        let sum2 = 0;
        let max = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const m = playRound(cfg.params.mine, strat, rng);
          sum += m;
          sum2 += m * m;
          max = Math.max(max, m);
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
        rows.push(
          `${cfg.label.padEnd(28)} ${name.padEnd(36)} rtp ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}% max ${max.toFixed(2)} (exact ${(exactValue(cfg.params.mine, strat) * 100).toFixed(4)}%)`,
        );
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_WIN);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(`rounds ${ROUNDS}\n${rows.join('\n')}`);
  });
});
