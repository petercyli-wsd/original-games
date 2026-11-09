// Fairness audit: can any way of playing Line of Sight beat the RTP?
//
// The settings (bet side, orchard size, targets) are locked at the bet:
// Game.tsx copies them into round.s and every chip is disabled while live.
// Each reveal draws 1 + rng.int(N) when it starts (a column, then a row, per
// target, in order), and the round's value is cashOut = prize × Π P_i. The
// Bet itself reveals the first column; after that the only decision, at every
// checkpoint, is cash out or reveal the next coordinate. So the game is fair
// iff the cash-out is a martingale over one reveal. A reveal has exactly N
// equally likely outcomes, so that is checked exactly, everywhere.
//
// Strategies (every eval config), against RTP:
//   (a) the tester's: reveal only when the reveal's survival chance
//       (1 − stepRisk: the lit rows for a row, the live columns for a
//       column) is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > bet;
//   (c) play to the end;
//   (d) bank lucky columns: cash out whenever the column just shown has more
//       lit rows than average (V jumped up), reveal on the rest;
//   (d') the reverse: reveal a row only on a lucky column.
// Each is computed exactly (finite recursion over N outcomes per reveal) and
// simulated with the game's reveal(). Default: 8k rounds per cell, 4 SE;
// FAIRNESS_FULL=1 runs every cell until its SE is ≤ 0.3%.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  ALL_SETTINGS,
  MAX_MULTIPLIER,
  RTP,
  VOLATILITY,
  cashOut,
  chanceOf,
  litRows,
  liveChance,
  nextStep,
  prizeOf,
  reveal,
  stepRisk,
  targetChance,
  type Settings,
  type Target,
} from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;

/** Cash out at this checkpoint? */
type Stop = (s: Settings, t: readonly Target[]) => boolean;

/** Whether the target being revealed has its column shown and that column beats the average. */
function luckyColumn(s: Settings, t: readonly Target[]): boolean | null {
  const st = nextStep(s, t);
  if (!st || st.kind !== 'row') return null;
  return chanceOf(s, t[st.index]) > targetChance(s.bet, s.size);
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) reveal only at ≥ 80% safe', stop: (s, t) => 1 - stepRisk(s, t) < 0.8 },
  { name: '(b) take any profit', stop: (s, t) => cashOut(s, t) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) bank lucky columns', stop: (s, t) => luckyColumn(s, t) === true },
  { name: "(d') reveal rows only on lucky columns", stop: (s, t) => luckyColumn(s, t) === false },
];

/**
 * Exact expected payout of revealing from `t` on, then following `stop` at
 * every checkpoint. Resolved targets all have chance 1 (a lost one ends the
 * round), so the state is the next step and the current column: memoised so.
 */
function exactValue(s: Settings, t0: readonly Target[], stop: Stop): number {
  const memo = new Map<string, number>();
  const key = (t: readonly Target[]) => {
    const st = nextStep(s, t);
    return st ? `${st.index}:${st.kind}:${t[st.index]?.a ?? 0}` : 'end';
  };
  // Checkpoint payoff when stopping (or the round's end), else null; cached per state.
  const stops = new Map<string, number | null>();
  const revealFrom = (t: readonly Target[]): number => {
    const k = key(t);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let sum = 0;
    for (let v = 1; v <= s.size; v++) {
      const next = reveal(s, t, v);
      if (liveChance(s, next) === 0) continue;
      const kn = key(next);
      let pay = stops.get(kn);
      if (pay === undefined) stops.set(kn, (pay = !nextStep(s, next) || stop(s, next) ? cashOut(s, next) : null));
      sum += pay ?? revealFrom(next);
    }
    const out = sum / s.size;
    memo.set(k, out);
    return out;
  };
  return revealFrom(t0);
}

/** One round as Game.tsx plays it: the bet reveals the first column, then cash out or reveal at each checkpoint. */
function playRound(s: Settings, stop: Stop, rng: Rng): number {
  let t: Target[] = [];
  for (;;) {
    t = reveal(s, t, 1 + rng.int(s.size));
    if (liveChance(s, t) === 0) return 0;
    if (!nextStep(s, t)) return cashOut(s, t);
    if (stop(s, t)) return cashOut(s, t);
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number, adaptive = false, maxRounds = 40_000_000) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let n = 0;
  let max = 0;
  const stat = () => {
    const mean = s / n;
    return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n), max, n };
  };
  for (;;) {
    const goal = n + (n < rounds ? rounds - n : 100_000);
    for (; n < goal; n++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    if (!adaptive || stat().se <= 0.003 || n >= maxRounds) return stat();
  }
}

/**
 * Every kind of checkpoint a round of these settings can reach: for the first,
 * second and last target, before its column and after each live column. (A
 * middle target's checkpoints differ from these only by the factor 1 that
 * each resolved target contributes to V.)
 */
function allCheckpoints(s: Settings): Target[][] {
  // A resolved winning target for this bet (any lit tree).
  let win: Target | null = null;
  for (let a = 1; a <= s.size && !win; a++) for (let b = 1; b <= s.size && !win; b++) if (chanceOf(s, { a, b }) === 1) win = { a, b };
  const out: Target[][] = [];
  for (const i of new Set([0, 1, s.count - 1].filter((j) => j < s.count))) {
    const done = Array.from({ length: i }, () => ({ ...win! }));
    if (i > 0) out.push(done);
    for (let a = 1; a <= s.size; a++) if (litRows(s.bet, a, s.size) > 0) out.push([...done, { a, b: null }]);
  }
  return out;
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, s]) => ({ level, s }));

describe('Line of Sight fairness', () => {
  it('martingale, exhaustive: at every checkpoint of every setting, E[V after the next reveal] over its N outcomes = V (1e-12)', () => {
    let checked = 0;
    for (const s of ALL_SETTINGS) {
      for (const t of allCheckpoints(s)) {
        const v = cashOut(s, t);
        let sum = 0;
        for (let x = 1; x <= s.size; x++) sum += cashOut(s, reveal(s, t, x));
        expect(Math.abs(sum / s.size - v)).toBeLessThan(1e-12 * Math.max(1, v));
        // The reveal's bust chance on screen is the true chance V drops to 0.
        let dead = 0;
        for (let x = 1; x <= s.size; x++) if (liveChance(s, reveal(s, t, x)) === 0) dead++;
        expect(dead / s.size).toBeCloseTo(stepRisk(s, t), 12);
        checked++;
      }
      // The bet's own first reveal: from RTP.
      let sum = 0;
      for (let x = 1; x <= s.size; x++) sum += cashOut(s, reveal(s, [], x));
      expect(Math.abs(sum / s.size - RTP)).toBeLessThan(1e-12);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('martingale at 40 states reached by random play (incl. the last row of the last target)', () => {
    const rng = createRng(seededSource(61));
    let states = 0;
    let lastRow = 0;
    for (let guard = 0; states < 40 && guard < 10_000; guard++) {
      const s = ALL_SETTINGS[rng.int(ALL_SETTINGS.length)];
      let t: Target[] = [];
      const depth = 1 + rng.int(2 * s.count);
      for (let k = 0; k < depth; k++) {
        const next = reveal(s, t, 1 + rng.int(s.size));
        if (liveChance(s, next) === 0 || !nextStep(s, next)) break;
        t = next;
      }
      if (!t.length) continue;
      const v = cashOut(s, t);
      let sum = 0;
      for (let x = 1; x <= s.size; x++) sum += cashOut(s, reveal(s, t, x));
      expect(Math.abs(sum / s.size - v)).toBeLessThan(1e-12 * Math.max(1, v));
      const st = nextStep(s, t)!;
      if (st.index === s.count - 1 && st.kind === 'row') lastRow++;
      states++;
    }
    expect(states).toBe(40);
    expect(lastRow).toBeGreaterThan(0);
  });

  it('strategies, exactly: every rule returns RTP to 1e-12 on every 10×10 and 20×20 setting and the 50×50 ones up to 3 targets', () => {
    for (const s of ALL_SETTINGS.filter((x) => x.size <= 20 || x.count <= 3)) {
      for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(s, [], stop) - RTP)).toBeLessThan(1e-12);
    }
  });

  it(`strategies, simulated with reveal(): every eval config × rule within 4 SE of RTP${FULL ? ' (SE ≤ 0.3%)' : ''}, and no payout above the bound`, () => {
    const rows: string[] = [];
    let seed = 700;
    for (const { level, s } of CONFIGS) {
      for (const { name, stop } of STRATEGIES) {
        const r = mc((rng) => playRound(s, stop, rng), FULL ? 200_000 : 8_000, seed++, FULL);
        rows.push(`${level.padEnd(8)} ${name.padEnd(40)} ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}%  n=${r.n}  max=${r.max.toFixed(2)}`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(prizeOf(s) + 1e-9);
      }
    }
    expect(Math.max(...ALL_SETTINGS.map(prizeOf))).toBeLessThanOrEqual(MAX_MULTIPLIER);
    if (FULL) console.log(rows.join('\n'));
  }, 600_000);
});
