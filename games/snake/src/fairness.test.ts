// Fairness audit: can any way of playing Snake beat the RTP?
//
// Each step draws one of four directions (rng.int(4), exactly uniform on the
// 2^32 RNG grid since 4 divides 2^32). The only decision is at a checkpoint:
// cash out at the current value, or step (by hand or by an Auto rule). Grid
// and target are locked once the stake is placed. A safe step with f free
// directions multiplies the value by 4/f, a blocked one ends the round at 0,
// the round auto-cashes when trapped (f = 0) and pays out at the target.
//
// Binding checks are exact:
//   - the martingale step through the real `step()` at ≥ 30 varied states per
//     config (random rounds, near the target, next to walls and body, f = 1);
//   - for every grid × target, the best and the worst stopping strategy over
//     every path (full enumeration of the walk tree, each step 1/4): both are
//     worth exactly RTP, so no rule (the tester's, any profit, Auto 75/50/All,
//     anything history-dependent) can differ from RTP.
// Monte Carlo then plays (a)–(d) and the eval mix on the real `step()`.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { GRIDS, MAX_MULTIPLIER, RTP, TARGETS, afterSafeStep, autoStop, centre, freeCount, neighbours, step, type Dir } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 100_000);

/**
 * Exact best (sup) and worst (inf) value over all stopping strategies from a
 * state, enumerating every future path. The player may stop at any
 * checkpoint, i.e. any state with path length ≥ 2 (the first step is part of
 * the bet). Forced stops: target reached, trapped.
 */
function extremes(n: number, target: number, path: readonly number[], cash: number): { sup: number; inf: number } {
  const nb = neighbours(n);
  const seen = new Uint8Array(n * n);
  for (const c of path) seen[c] = 1;
  const visit = (head: number, len: number, value: number): [number, number] => {
    if (len >= target) return [value, value];
    let f = 0;
    for (let d = 0; d < 4; d++) {
      const c = nb[head * 4 + d];
      if (c >= 0 && !seen[c]) f++;
    }
    if (f === 0) return [value, value];
    const next = afterSafeStep(value, f);
    let hi = 0;
    let lo = 0;
    for (let d = 0; d < 4; d++) {
      const c = nb[head * 4 + d];
      if (c >= 0 && !seen[c]) {
        seen[c] = 1;
        const [h, l] = visit(c, len + 1, next);
        seen[c] = 0;
        hi += h / 4;
        lo += l / 4;
      }
    }
    // Stopping is allowed from length 2 on.
    return len >= 2 ? [Math.max(value, hi), Math.min(value, lo)] : [hi, lo];
  };
  const [sup, inf] = visit(path[path.length - 1], path.length, cash);
  return { sup, inf };
}

/** RTP = mean payout per unit stake, with its standard error. */
function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const m = play(rng);
    s += m;
    s2 += m * m;
    if (m > max) max = m;
  }
  const mean = s / rounds;
  return { rtp: mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** true = cash out at this checkpoint. */
type Policy = (n: number, path: readonly number[], cash: number) => boolean;

/** One round as the game plays it (Game.tsx stepOnce / autoStop): the first step is part of the bet. */
function playRound(n: number, target: number, rng: Rng, cashOut: Policy): number {
  let path = [centre(n)];
  let cash = RTP;
  while (!autoStop(n, target, path)) {
    if (path.length > 1 && cashOut(n, path, cash)) break;
    const r = step(n, path, cash, rng.int(4) as Dir);
    if (!r.safe) return 0;
    path = r.path;
    cash = r.cash;
  }
  return cash;
}

const POLICIES: Record<string, Policy> = {
  // (a) Step only when the step survives with chance ≥ 0.8: f/4 ≥ 0.8 means f = 4.
  // At length 2 the body always blocks one direction (f ≤ 3), so (a) cashes
  // at the first checkpoint at exactly 0.99: a deterministic RTP.
  '(a) step iff f/4 ≥ 0.8': (n, path) => freeCount(n, path) / 4 < 0.8,
  '(b) cash once V > 1': (_n, _p, cash) => cash > 1,
  '(c) play to the end': () => false,
  // (d1) After the first checkpoint (always f = 3), take only the ×4 / ×2 steps
  // (the highest-variance ones); cash before any later ×4/3 step.
  '(d1) then step only when f ≤ 2': (n, path) => path.length > 2 && freeCount(n, path) > 2,
  // (d2) Auto "≥ 75%": step while ≥ 3 of 4 directions are free.
  '(d2) Auto 75%': (n, path) => freeCount(n, path) < 3,
  // (d3) Ride a lucky run: cash only once the value has doubled, or when f = 1.
  '(d3) cash at 2× or f = 1': (n, path, cash) => cash >= 2 || freeCount(n, path) === 1,
};

/** Reaches varied checkpoints by random play (random stop lengths), returning the states seen. */
function reachStates(n: number, target: number, rng: Rng, want: number) {
  const states: { path: number[]; cash: number }[] = [];
  let guard = 0;
  while (states.length < want && guard++ < 100_000) {
    let path = [centre(n)];
    let cash = RTP;
    const stopAt = 2 + rng.int(target - 1);
    while (!autoStop(n, target, path) && path.length < stopAt) {
      const r = step(n, path, cash, rng.int(4) as Dir);
      if (!r.safe) break;
      path = r.path;
      cash = r.cash;
    }
    if (path.length >= 2 && !autoStop(n, target, path)) states.push({ path, cash });
  }
  return states;
}

describe('Snake fairness', () => {
  it('martingale through the real step(): E[value after the next step] = value now at ≥ 30 varied states per config', () => {
    const rng = createRng(seededSource(4242));
    let total = 0;
    let lowFree = 0;
    let nearEnd = 0;
    for (const { params } of evalSpec.configs) {
      const { grid, target } = params;
      const states = reachStates(grid, target, rng, 40);
      // Also the start: the first step from the centre is free (×1) and part of the bet.
      states.push({ path: [centre(grid)], cash: RTP });
      expect(states.length).toBeGreaterThanOrEqual(31);
      for (const { path, cash } of states) {
        let e = 0;
        for (let d = 0; d < 4; d++) {
          const r = step(grid, path, cash, d as Dir);
          // A blocked direction ends at 0; a safe one at cash · 4/f.
          e += (r.safe ? r.cash : 0) / 4;
          if (!r.safe) expect(r.cash).toBe(0);
        }
        expect(Math.abs(e - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        // f = 0 is never offered: it is an auto-stop.
        expect(freeCount(grid, path)).toBeGreaterThan(0);
        if (freeCount(grid, path) === 1) lowFree++;
        if (path.length === target - 1) nearEnd++;
        total++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(120);
    expect(lowFree).toBeGreaterThan(0);
    expect(nearEnd).toBeGreaterThan(0);
  });

  it('exact: for every grid × target, the best and the worst stopping strategy are both worth RTP', () => {
    for (const n of GRIDS)
      for (const t of TARGETS) {
        const { sup, inf } = extremes(n, t, [centre(n)], RTP);
        expect(Math.abs(sup - RTP)).toBeLessThan(1e-12);
        expect(Math.abs(inf - RTP)).toBeLessThan(1e-12);
      }
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('exact, from mid-round states: no continuation beats cashing out now (sup = inf = value)', () => {
    const rng = createRng(seededSource(77));
    for (const { params } of evalSpec.configs) {
      for (const { path, cash } of reachStates(params.grid, params.target, rng, 10)) {
        const { sup, inf } = extremes(params.grid, params.target, path, cash);
        expect(Math.abs(sup - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        expect(Math.abs(inf - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
      }
    }
  });

  it('strategies: (a)–(d) on the real step() for every eval config, plus the eval mix: RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      Object.entries(POLICIES).forEach(([name, policy], pi) => {
        const r = mc((rng) => playRound(params.grid, params.target, rng, policy), ROUNDS, 5100 + 10 * ci + pi);
        rows.push(`${label.padEnd(26)} ${name.padEnd(26)} ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%  max ${r.max.toFixed(2)}`);
        // (a) is deterministic here (len 2 always has f = 3, so it cashes at 0.99): zero SE.
        expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
      const e = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 5900 + ci);
      rows.push(`${label.padEnd(26)} ${'eval mix'.padEnd(26)} ${(e.rtp * 100).toFixed(3)}% ± ${(e.se * 100).toFixed(3)}%`);
      expect(Math.abs(e.rtp - RTP)).toBeLessThan(4 * e.se);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
