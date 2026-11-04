// Fairness audit: no strategy, click timing or UI path beats the RTP.
//
// What the player sees in flight is one fact: the curve is at k cents, so
// C ≥ k. Every action is a function of that history, so every strategy is a
// stopping rule on the curve. The checks below use the game's own functions
// (crashFromDraw, cashAt, centsAt, autoEnd, nextMilestone, ...):
//
//  1. Grid-exact law. The host rng is a 32-bit grid, so P(C ≥ k) is a count of
//     grid draws. We find the exact count by bisection on crashFromDraw and
//     check P(C ≥ k) ≤ 99/k at every level, cap included (house-side rounding).
//  2. Martingale. At ≥ 30 states reached by playing, E[value after the next
//     event | C ≥ k] = value now, for every action: cash now, wait one cent,
//     wait one second of flight, wait to the UI's next milestone, ride to the
//     cap. Exact (grid count), plus 100k-sample Monte Carlo at a few states.
//  3. Adversarial strategies per eval config: (a) the tester's 80% rule on the
//     on-screen "Reach X from here" chance, (b) take any profit (1.01×),
//     (c) play to the end (the auto target, and never clicking: the cap),
//     (d) every UI exploit path at once (leave mid-flight, clicks between
//     frames past the target, exact tie at the target). Each is measured two
//     ways: stratified Monte Carlo over the draw, and Rao-Blackwellised exact
//     (each sampled plan priced by the exact grid count).
import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  CAP,
  MAX_MULTIPLIER,
  MIN_TARGET,
  RTP,
  autoEnd,
  cashAt,
  centsAt,
  clampTarget,
  crashCents,
  crashFromDraw,
  endTime,
  nextMilestone,
  reachChance,
  targetTime,
  timeTo,
} from './math';

const GRID = 2 ** 32;
// FAIRNESS_ROUNDS=1000000 FAIRNESS_REPORT=1 npx vitest run games/crash/src/fairness.test.ts for the full run.
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ROUNDS = Number(ENV.FAIRNESS_ROUNDS ?? 40_000);
const REPORT = !!ENV.FAIRNESS_REPORT;

/** Smallest grid index j with f(j / 2^32) ≥ k, for f increasing in j. */
function firstJ(f: (u: number) => number, k: number): number {
  let lo = 0;
  let hi = GRID; // f(hi) treated as +∞
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid / GRID) >= k) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Exact P(C ≥ k) under the host's 32-bit rng, through the game's draw. */
const memo = new Map<number, number>();
function reachGrid(k: number): number {
  if (k <= 99) return 1;
  let p = memo.get(k);
  if (p === undefined) memo.set(k, (p = (GRID - firstJ(crashFromDraw, k)) / GRID));
  return p;
}

/** The same count for the old draw crashCents(u) (decreasing in u): #{j : crashCents(j/2^32) ≥ k}. */
function reachGridOld(k: number): number {
  let lo = 0;
  let hi = GRID;
  // largest j with crashCents(j) ≥ k, via first j with crashCents(j) < k
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (crashCents(mid / GRID) < k) hi = mid;
    else lo = mid + 1;
  }
  return lo / GRID;
}

// ---------- the player's possible plans, played through the game's own code paths ----------

type Plan =
  | { kind: 'click'; tau: number; target: number | null } // manual Cash out at flight time tau
  | { kind: 'leave'; tau: number } // closes the game mid-flight (ticket fair value)
  | { kind: 'target'; target: number } // auto cash-out, no click
  | { kind: 'cap' }; // never clicks

/** Game.cashOut: an auto target passed between frames fires first; a click under 1.01× does nothing. */
function payout(plan: Plan, crash: number): number {
  switch (plan.kind) {
    case 'click': {
      const { tau, target } = plan;
      if (target !== null && crash >= target && tau >= targetTime(target)) return target / 100;
      const k = cashAt(tau, crash);
      if (k === 0) {
        // Crashed first; if a target was set it would already have paid.
        const end = autoEnd(target, crash);
        return end.kind === 'crashed' ? 0 : end.cents / 100;
      }
      if (k < MIN_TARGET) throw new Error('click below 1.01× is ignored by the game');
      return k / 100;
    }
    case 'leave':
      // useTicket fair value with no target: a cash-out right now (cashAt, which allows 1.00×).
      return cashAt(plan.tau, crash) / 100;
    case 'target': {
      const end = autoEnd(plan.target, crash);
      return end.kind === 'crashed' ? 0 : end.cents / 100;
    }
    case 'cap': {
      const end = autoEnd(null, crash);
      return end.kind === 'crashed' ? 0 : end.cents / 100;
    }
  }
}

/** The cent level a plan pays at if the curve gets there (it pays that level iff C ≥ level). */
function planLevel(plan: Plan): number {
  switch (plan.kind) {
    case 'click':
      return plan.target !== null && plan.tau >= targetTime(plan.target) ? plan.target : centsAt(plan.tau);
    case 'leave':
      return centsAt(plan.tau);
    case 'target':
      return plan.target;
    case 'cap':
      return CAP;
  }
}

const logU = (rng: Rng, lo: number, hi: number) => Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo)));

type Band = { lo: number; hi: number };
const CONFIGS = evalSpec.configs.map((c) => ({ label: c.label, band: c.params as Band }));

/** (a) The tester: look at the curve somewhere in the band; keep riding to the
 *  next on-screen milestone while its chance (k / milestone, as the chance bar shows) is ≥ 80%, else cash out. */
function testers(b: Band, rng: Rng): Plan {
  let k = clampTarget(logU(rng, b.lo, b.hi));
  for (;;) {
    const m = nextMilestone(k);
    if (k / m >= 0.8 && m < CAP) k = m;
    else if (k / m >= 0.8) return { kind: 'cap' };
    else return { kind: 'click', tau: targetTime(k), target: null };
  }
}

/** (b) Take any profit: cash the first moment the value exceeds the stake (1.01×). */
const anyProfit = (): Plan => ({ kind: 'click', tau: targetTime(MIN_TARGET), target: null });

/** (c) Play to the end: an auto target in the band and no click. */
const toTheEnd = (b: Band, rng: Rng): Plan => ({ kind: 'target', target: clampTarget(logU(rng, b.lo, b.hi)) });

/** (d) Every UI path: leave mid-flight (even at 1.00×), click a frame after the target, sit on the exact tie. */
function uiPaths(b: Band, rng: Rng): Plan {
  const r = rng.next();
  const target = clampTarget(logU(rng, b.lo, b.hi));
  if (r < 0.25) return { kind: 'leave', tau: rng.next() * targetTime(target) }; // includes the 1.00× stretch
  if (r < 0.5) return { kind: 'click', tau: targetTime(target) + rng.next() * 50, target }; // late frame
  if (r < 0.75) return { kind: 'click', tau: targetTime(target) - 1e-6, target }; // one tick before the target
  return { kind: 'click', tau: targetTime(Math.max(MIN_TARGET, target)), target: null }; // exactly on a cent edge
}

const STRATEGIES: [string, (b: Band, rng: Rng) => Plan][] = [
  ['(a) tester 80% rule', testers],
  ['(b) any profit', anyProfit],
  ['(c) play to the end', toTheEnd],
  ['(d) UI paths', uiPaths],
];

/** Stratified Monte Carlo over the crash draw (R independent replicates give the SE). */
function measure(strategy: (b: Band, rng: Rng) => Plan, b: Band, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  const R = 20;
  const per = Math.floor(rounds / R);
  const means: number[] = [];
  let rbSum = 0;
  let rbSq = 0;
  for (let r = 0; r < R; r++) {
    let sum = 0;
    for (let i = 0; i < per; i++) {
      // Stratified draw on the host grid: one draw in each slice [i/per, (i+1)/per).
      const u = Math.floor(((i + rng.next()) / per) * GRID) / GRID;
      const plan = strategy(b, rng);
      sum += payout(plan, crashFromDraw(u));
      // Rao-Blackwell: the plan's exact value, level × P(C ≥ level) on the grid.
      const lvl = planLevel(plan);
      const v = (lvl / 100) * reachGrid(lvl);
      rbSum += v;
      rbSq += v * v;
    }
    means.push(sum / per);
  }
  const mean = means.reduce((a, x) => a + x, 0) / R;
  const se = Math.sqrt(means.reduce((a, x) => a + (x - mean) ** 2, 0) / (R - 1) / R);
  const n = R * per;
  const rb = rbSum / n;
  const rbSe = Math.sqrt(Math.max(0, rbSq / n - rb * rb) / n);
  return { mean, se, rb, rbSe };
}

describe('Crash fairness', () => {
  it('the draw is exact on the 32-bit host grid, and never rounds in the player\'s favour', () => {
    const levels = [100, 101, 150, 199, 200, 201, 333, 1000, 12_345, 99_999, 1_000_000, 10_000_000, CAP - 1, CAP];
    for (const k of levels) {
      const p = reachGrid(k);
      expect(p).toBeLessThanOrEqual(reachChance(k)); // house-side rounding
      expect(reachChance(k) - p).toBeLessThanOrEqual(1 / GRID);
      expect((k / 100) * p).toBeLessThanOrEqual(RTP); // every target, the cap included
    }
    // The old draw (crashCents(u) with u ∈ [0, 1)) counted u = 0 as well: one grid point too many.
    expect((CAP / 100) * reachGridOld(CAP)).toBeGreaterThan(RTP + 2e-4);
    // The draw u = 0 is U = 1: an instant crash. The largest draw reaches the cap.
    expect(crashFromDraw(0)).toBe(99);
    expect(crashFromDraw((GRID - 1) / GRID)).toBe(CAP);
  });

  it('martingale: at ≥ 30 reachable states every action keeps E[value] = value (exact)', () => {
    const rng = createRng(seededSource(101));
    const states: number[] = [];
    while (states.length < 36) {
      const c = crashFromDraw(rng.next());
      if (c < 100) continue; // instant crash: no in-flight state
      const tau = rng.next() * endTime(c);
      states.push(Math.min(c, centsAt(tau)));
      if (states.length % 6 === 0) states.push(Math.max(100, c)); // the last cent before this curve crashes
    }
    states.push(100, 101, 5_000_000, CAP - 100, CAP - 1); // start, first cashable, deep, near the cap
    for (const k of states) {
      const V = k / 100;
      const pk = reachGrid(k);
      const tau = targetTime(k);
      const nexts = [
        k + 1, // the next cent
        centsAt(tau + 1000), // one second of flight
        nextMilestone(k), // the on-screen milestone
        CAP, // ride to the auto cash-out at the cap
      ].map((x) => Math.min(CAP, Math.max(k, x)));
      for (const k2 of nexts) {
        // Continuous law (the design): exact to rounding.
        const eCont = (k2 / 100) * (reachChance(k2) / reachChance(k));
        expect(Math.abs(eCont - V) / V).toBeLessThan(1e-12);
        // Host grid: exact counts; deviation bounded by the grid (≤ k2 / (99·2^32) relative).
        const eGrid = (k2 / 100) * (reachGrid(k2) / pk);
        expect(Math.abs(eGrid - V) / V).toBeLessThan(1e-12 + (2 * k2) / (99 * GRID));
      }
      // Cash now pays V through the game's own path (at huge k the float clock can read one cent lower, never higher).
      if (k >= MIN_TARGET && k < CAP) {
        const paid = payout({ kind: 'click', tau: targetTime(k), target: null }, k);
        expect(paid).toBeLessThanOrEqual(V);
        expect(V - paid).toBeLessThan(0.0100001);
      }
    }
    expect(states.length).toBeGreaterThanOrEqual(30);
  });

  it('martingale, Monte Carlo through the draw (100k samples, 4 SE)', () => {
    const rng = createRng(seededSource(7));
    for (const [k, k2] of [
      [101, 102],
      [150, 200],
      [200, 300],
      [1234, 2000],
      [50_000, 100_000],
    ]) {
      // Sample C | C ≥ k exactly: a uniform grid draw among those that reach k.
      const j0 = firstJ(crashFromDraw, k);
      const n = 100_000;
      let sum = 0; // (the full 200k+ runs per strategy live in the scratch script; this keeps the file fast)
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const j = j0 + Math.floor(rng.next() * (GRID - j0));
        const c = crashFromDraw(j / GRID);
        if (c < k) throw new Error('conditional draw below k');
        const v = payout({ kind: 'click', tau: targetTime(k2), target: null }, c);
        sum += v;
        sq += v * v;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - k / 100)).toBeLessThan(4 * se);
    }
  });

  it('adversarial strategies return the RTP on every eval config', () => {
    for (const [ci, { band }] of CONFIGS.entries()) {
      for (const [si, [, strat]] of STRATEGIES.entries()) {
        // 40k rounds keeps the file fast; the audit ran FAIRNESS_ROUNDS=1000000.
        // Report runs scale the high-variance configs so the Monte Carlo SE stays ≤ 0.3%.
        const r = measure(strat, band, REPORT ? ROUNDS * [1, 1, 4, 14][ci] : ROUNDS, 1000 + ci * 10 + si);
        if (REPORT) console.log(`${CONFIGS[ci].label} | ${STRATEGIES[si][0]} | MC ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)} | exact-per-plan ${(r.rb * 100).toFixed(6)}%`);
        // + 1e-4: a deterministic plan's only error under stratification is one boundary slice (≤ 1.01 / 10,000).
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-4);
        // Exact per plan: within the grid rounding of the RTP. (Float rounding in 99 / U can admit one extra grid
        // draw at a level, worth at most level × 2^-32: under 1e-9 below 1,000×, measured ≤ 1e-10 here.)
        expect(r.rb).toBeLessThanOrEqual(RTP + 1e-9);
        expect(RTP - r.rb).toBeLessThan(1e-5);
      }
    }
  });

  it('(c) never clicking is paid only at the cap: exactly the RTP, never above it', () => {
    const v = MAX_MULTIPLIER * reachGrid(CAP);
    if (REPORT) console.log(`never click (cap): ${(v * 100).toFixed(5)}% now, ${(MAX_MULTIPLIER * reachGridOld(CAP) * 100).toFixed(5)}% with the old draw`);
    expect(v).toBeLessThanOrEqual(RTP);
    expect(RTP - v).toBeLessThan(MAX_MULTIPLIER / GRID);
    expect(payout({ kind: 'cap' }, CAP)).toBe(MAX_MULTIPLIER);
    expect(payout({ kind: 'cap' }, CAP - 1)).toBe(0);
  });

  it('leaving mid-flight settles at a cash-out the player could have had, never above the curve', () => {
    const rng = createRng(seededSource(3));
    let bad = 0;
    for (let i = 0; i < 20_000; i++) {
      const c = crashFromDraw(rng.next());
      const tau = rng.next() * (endTime(c) + 2000);
      const paid = payout({ kind: 'leave', tau }, c);
      const k = centsAt(tau);
      // Before the crash: the cent on screen (or 0 if the clock already reads past C); after: 0 or the cap.
      const ok = tau < endTime(c) ? paid === (k <= c ? k / 100 : 0) : paid === (c >= CAP ? MAX_MULTIPLIER : 0);
      if (!ok) bad++;
    }
    expect(bad).toBe(0);
    expect(timeTo(1)).toBe(0);
  });
});
