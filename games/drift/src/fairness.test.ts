// Fairness audit: can any way of playing Drift beat the RTP?
//
// The round is a fair ±1 walk from x0 between a red wall (0) and a green one
// (W). The cash-out at x is RTP·x/x0 and every ending (wall, take-profit,
// stop-loss, cash-out) pays that same function of the position, so the value
// is a bounded martingale and optional stopping gives RTP for every rule.
//
// Decisions a player has mid-round: cash out (button or C, while running or
// paused), pause / continue, and the burst size (the burst chips stay enabled
// mid-round). Start, track and auto levels are locked while live. Burst and
// pause only change *when* the player gets to stop, so every strategy is a
// stopping rule on the step-by-step walk; burst 1 gives the finest control
// and is what the strategies below use.
//
// Checks, all on the real reducer (round.ts) and the real step() / endingAt()
// / cashMultiplier():
//   - the ±1 draw is exactly ½ / ½ on the host RNG's 32-bit grid;
//   - martingale: at 40+ reached states (running and paused, walls close,
//     auto levels one step away), for every action, E[V after the next step]
//     = V now, enumerating both steps through the reducer;
//   - optimal stopping: the Snell envelope of the walk (the best any rule can
//     do, path-dependent ones included, since the payoff depends only on the
//     Markov position) equals V everywhere, exactly;
//   - strategies (a) cash out when the next step can bust (x = 1, survival ½
//     < 0.8), else step; (b) take any profit; (c) hold to a wall; (d) trailing
//     stop / take 2×: exact by pushing the walk's distribution forward for
//     (a)–(c), Monte Carlo for every strategy on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TRACKS, cashMultiplier, endingAt, step, type AutoRules } from './math';
import { initialState, position, reducer, type GameState } from './round';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);
const NO_RULES: AutoRules = { takeProfit: null, stopLoss: null };

/** Value of a state to the player: the settled multiplier once over, else the cash-out now. */
function value(s: GameState): number {
  const r = s.round!;
  return s.phase === 'over' ? r.mult : cashMultiplier(position(r), r.x0);
}

/** Stop rule at a decision point (before each step): position, start, peak so far. */
type Stop = (x: number, x0: number, peak: number, W: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  // Survival of the next step is 1 unless the dot is one step off red (then ½).
  { name: '(a) step while survival ≥ 0.8', stop: (x) => x === 1 },
  { name: '(b) take any profit', stop: (x, x0) => cashMultiplier(x, x0) > 1 },
  { name: '(c) hold to a wall', stop: () => false },
  { name: '(d) trailing stop 2 off peak, or take 2×', stop: (x, x0, peak) => cashMultiplier(x, x0) >= 2 || (peak > x0 && x <= peak - 2) },
];

/** One round with step() / endingAt() / cashMultiplier(), as the reducer plays it (checked equal below). */
function playFast(W: number, x0: number, stop: Stop, rng: Rng, rules: AutoRules = NO_RULES): number {
  let x = x0;
  let peak = x0;
  for (;;) {
    if (stop(x, x0, peak, W)) return cashMultiplier(x, x0);
    x = step(x, rng);
    if (x > peak) peak = x;
    if (endingAt(x, W, rules)) return cashMultiplier(x, x0);
  }
}

/** The same round through the real reducer, burst 1, drawing each step like Game.tsx (step(0, rng)). */
function playReducer(W: number, x0: number, stop: Stop, rng: Rng, rules: AutoRules = NO_RULES): number {
  let s = reducer(initialState(), { type: 'start', bet: 1, W, x0, rules, burst: 1 });
  let peak = x0;
  for (;;) {
    const x = position(s.round!);
    if (stop(x, x0, peak, W)) s = reducer(s, { type: 'cashOut' });
    else {
      if (s.phase === 'paused') s = reducer(s, { type: 'continue', burst: 1 });
      s = reducer(s, { type: 'step', dx: step(0, rng) as 1 | -1 });
      peak = Math.max(peak, position(s.round!));
    }
    if (s.phase === 'over') return s.round!.mult;
  }
}

/** Exact expected payout of a Markov stop rule stop(x), by pushing the walk's distribution forward. */
function exactValue(W: number, x0: number, stop: (x: number) => boolean): number {
  let dist = new Float64Array(W + 1);
  dist[x0] = 1;
  let ev = 0;
  for (let t = 0; t < 5_000_000; t++) {
    const next = new Float64Array(W + 1);
    let alive = 0;
    for (let x = 1; x < W; x++) {
      if (!dist[x]) continue;
      if (stop(x)) {
        ev += dist[x] * cashMultiplier(x, x0);
        continue;
      }
      next[x - 1] += dist[x] / 2;
      next[x + 1] += dist[x] / 2;
    }
    ev += next[W] * cashMultiplier(W, x0);
    next[0] = next[W] = 0;
    for (let x = 1; x < W; x++) alive += next[x];
    dist = next;
    if (alive < 1e-13) return ev;
  }
  throw new Error('walk did not finish');
}

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

/** Live states met while playing random rounds through the reducer, with random bursts, pauses and auto levels. */
function reachedStates(count: number, rng: Rng): GameState[] {
  const out: GameState[] = [];
  while (out.length < count) {
    const W = TRACKS[rng.int(TRACKS.length)];
    const x0 = 1 + rng.int(W - 1);
    const rules: AutoRules = {
      takeProfit: rng.next() < 0.4 ? Math.min(W - 1, x0 + 1 + rng.int(3)) : null,
      stopLoss: rng.next() < 0.4 && x0 > 1 ? Math.max(1, x0 - 1 - rng.int(3)) : null,
    };
    if (rules.takeProfit !== null && rules.takeProfit <= x0) rules.takeProfit = null;
    if (rules.stopLoss !== null && rules.stopLoss >= x0) rules.stopLoss = null;
    let s = reducer(initialState(), { type: 'start', bet: 1, W, x0, rules, burst: [1, 5, 10, 25, 0][rng.int(5)] });
    for (let t = 0; t < 400 && s.phase !== 'over'; t++) {
      if (s.phase === 'paused') s = reducer(s, { type: 'continue', burst: [1, 5, 0][rng.int(3)] });
      else if (rng.next() < 0.05) s = reducer(s, { type: 'pause' });
      if (s.phase === 'running' || s.phase === 'paused') {
        if (rng.next() < 0.15) out.push(s);
        if (s.phase === 'running') s = reducer(s, { type: 'step', dx: step(0, rng) as 1 | -1 });
      }
    }
  }
  return out.slice(0, count);
}

/** Hand-built live states: one step off either wall, auto levels one step away, the 99× start. */
function edgeStates(): GameState[] {
  const make = (W: number, x0: number, path: number[], rules: AutoRules = NO_RULES): GameState => {
    let s = reducer(initialState(), { type: 'start', bet: 1, W, x0, rules, burst: 0 });
    for (let i = 1; i < path.length; i++) s = reducer(s, { type: 'step', dx: (path[i] - path[i - 1]) as 1 | -1 });
    return s;
  };
  return [
    make(100, 1, [1]),
    make(100, 1, [1, 2, 1]),
    make(100, 50, [50, 51]),
    make(10, 9, [9]),
    make(20, 5, [5, 6, 7, 8], { takeProfit: 9, stopLoss: 4 }),
    make(20, 5, [5, 4, 5], { takeProfit: 6, stopLoss: 4 }),
    make(40, 39, [39, 38, 39]),
  ];
}

describe('Drift fairness', () => {
  it('the ±1 draw is exactly ½ / ½ on the host RNG grid (j / 2^32)', () => {
    // step() goes up iff rng.next() < 0.5, i.e. j < 2^31: exactly half the grid.
    const at = (u: number) => step(0, { next: () => u, int: () => 0, shuffle: (a) => a.slice() });
    expect(at((2 ** 31 - 1) / 2 ** 32)).toBe(1);
    expect(at(2 ** 31 / 2 ** 32)).toBe(-1);
    expect(at(0)).toBe(1);
    expect(at(1 - 2 ** -32)).toBe(-1);
  });

  it('martingale: at 40+ reached and edge states, every action keeps E[V after the next step] = V now (exact, via the reducer)', () => {
    const rng = createRng(seededSource(404));
    const states = [...reachedStates(40, rng), ...edgeStates()];
    expect(new Set(states.map((s) => s.round!.W)).size).toBeGreaterThanOrEqual(3);
    expect(states.some((s) => s.phase === 'paused')).toBe(true);
    expect(states.some((s) => s.phase === 'running')).toBe(true);
    for (const s of states) {
      const v = value(s);
      // Cash out: pays V now.
      expect(reducer(s, { type: 'cashOut' }).round!.mult).toBeCloseTo(v, 12);
      // Pause / continue with any burst: no draw, V unchanged; then the next step.
      const running =
        s.phase === 'paused' ? [1, 5, 0].map((b) => reducer(s, { type: 'continue', burst: b })) : [s, reducer(reducer(s, { type: 'pause' }), { type: 'continue', burst: 10 })];
      for (const r of running) {
        expect(value(r)).toBeCloseTo(v, 12);
        const up = reducer(r, { type: 'step', dx: 1 });
        const down = reducer(r, { type: 'step', dx: -1 });
        expect(Math.abs((value(up) + value(down)) / 2 - v)).toBeLessThan(1e-12);
      }
    }
  });

  it('optimal stopping: the Snell envelope equals the cash-out at every position (no rule can beat RTP)', () => {
    for (const W of TRACKS) {
      for (const x0 of [1, Math.max(1, W / 10), W / 2, W - 1]) {
        const V = (x: number) => cashMultiplier(x, x0);
        let U = Array.from({ length: W + 1 }, (_, x) => V(x));
        // Backward induction over a long horizon: U ← max(V, ½U(x−1) + ½U(x+1)) inside, walls absorb.
        for (let it = 0; it < 4 * W * W; it++) {
          const next = U.slice();
          for (let x = 1; x < W; x++) next[x] = Math.max(V(x), (U[x - 1] + U[x + 1]) / 2);
          U = next;
        }
        for (let x = 0; x <= W; x++) expect(Math.abs(U[x] - V(x))).toBeLessThan(1e-12);
        expect(U[x0]).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('the fast loop and the reducer play identical rounds from the same draws', () => {
    for (const { stop } of STRATEGIES) {
      for (const [W, x0] of [
        [20, 10],
        [100, 1],
        [40, 10],
      ]) {
        for (let seed = 0; seed < 200; seed++) {
          const a = playFast(W, x0, stop, createRng(seededSource(seed)));
          const b = playReducer(W, x0, stop, createRng(seededSource(seed)));
          expect(a).toBe(b);
        }
      }
    }
  });

  it('strategies (a)–(c) are exactly RTP on every eval config; (a)–(d) by Monte Carlo within 4 SE, max ≤ manifest', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { W, x0 } }, ci) => {
      const exact = [
        exactValue(W, x0, (x) => x === 1),
        exactValue(W, x0, (x) => cashMultiplier(x, x0) > 1),
        exactValue(W, x0, () => false),
      ];
      for (const e of exact) expect(e).toBeCloseTo(RTP, 9);
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playFast(W, x0, stop, r), ROUNDS, 8100 + 13 * ci + si);
        rows.push(
          `${label.padEnd(30)} ${name.padEnd(42)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%` +
            (si < 3 ? `  exact ${(exact[si] * 100).toFixed(9)}%` : ''),
        );
        // + 1e-9: rules that always stop at once (e.g. (a) from x0 = 1) have se = 0, and summing 0.99 many times drifts ~1e-12.
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
