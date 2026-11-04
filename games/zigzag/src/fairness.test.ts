// Fairness audit: can any way of playing Zigzag beat the RTP?
//
// Bars are uniform in [0, 1) from the host rng, drawn when each bar starts to
// rise. The cash-out is prize × P(fill the board | bars so far), with the
// chance an exact Entringer polynomial and prize = RTP / P(fill | start).
//
// Decisions mid-round: cash out or raise the next bar (length and "either
// way" are locked while live). The first bar rises at the bet and can't bust;
// in "either way" mode the second bar can't bust either. Those free steps are
// priced: the value before them is the average of the value after. Space =
// next bar, C = cash out; both call the same functions as the buttons. Every
// action is disabled while a bar rises, and the ticket reads a ref holding
// the resolved value (RTP right after the bet, then the post-bar value).
//
// The future depends only on (bars left m, last height x, the due direction),
// and by the reflection y ↦ 1 − y a down due from x is an up due from 1 − x.
// Checks, with the game's own functions (survives, stepSafe, winChance,
// chanceIfLands, upChance, prizeFor):
//   - martingale at ≥ 60 varied states (random reachable ones, plus the first
//     and last bars of every length): E[V after the next bar] = V, by
//     Gauss–Legendre quadrature on each side of the last bar (the value after
//     is a polynomial of degree ≤ 11 there, so 12 nodes are exact), and again
//     by 100k-sample Monte Carlo through rng.next() at 30 states (4 SE);
//   - the displayed safe zone equals the true survival chance (MC);
//   - strategies (a)–(d): exact expected payout by backward induction on a
//     fine grid of the reflected height (trapezoid, error ~1e-7), for every
//     setting, and by Monte Carlo through the real draws on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { LENGTHS, RTP, chanceIfLands, nextDir, prizeFor, stepSafe, survives, upChance, winChance, type Settings } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy-witness-zigzag.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const ALL: Settings[] = LENGTHS.flatMap((n) => [false, true].map((either) => ({ n, either })));

// ---------- quadrature ----------

/** Gauss–Legendre nodes and weights on [−1, 1]. */
function gaussLegendre(k: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= k; i++) {
    let t = Math.cos((Math.PI * (i - 0.25)) / (k + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = t;
      for (let j = 2; j <= k; j++) [p0, p1] = [p1, ((2 * j - 1) * t * p1 - (j - 1) * p0) / j];
      dp = (k * (t * p1 - p0)) / (t * t - 1);
      const dt = p1 / dp;
      t -= dt;
      if (Math.abs(dt) < 1e-16) break;
    }
    x.push(t);
    w.push(2 / ((1 - t * t) * dp * dp));
  }
  return { x, w };
}
const GL = gaussLegendre(12);
const integrate = (f: (y: number) => number, a: number, b: number) =>
  b <= a ? 0 : GL.x.reduce((s, t, i) => s + GL.w[i] * f(a + ((b - a) * (t + 1)) / 2), 0) * ((b - a) / 2);

// ---------- states ----------

const cashValue = (bars: number[], s: Settings) => (bars.length >= s.n ? prizeFor(s) : prizeFor(s) * winChance(bars, s));

/** A random reachable live state: bars drawn by the real process, stopped at a random checkpoint. */
function randomState(s: Settings, rng: Rng, k = 1 + rng.int(s.n - 1)): number[] {
  for (;;) {
    const bars = [rng.next()];
    let ok = true;
    while (ok && bars.length < k) {
      const y = rng.next();
      ok = survives(bars, y, s.either);
      bars.push(y);
    }
    if (ok) return bars;
  }
}

function varietyOfStates(): { s: Settings; bars: number[] }[] {
  const rng = createRng(seededSource(404));
  const out: { s: Settings; bars: number[] }[] = [];
  for (const s of ALL) {
    out.push({ s, bars: randomState(s, rng, 1) }); // the first checkpoint (the "either" free bar is next)
    out.push({ s, bars: randomState(s, rng, s.n - 1) }); // one bar from the prize
    out.push({ s, bars: randomState(s, rng) }, { s, bars: randomState(s, rng) });
  }
  // Extreme heights: near-certain and near-impossible next bars.
  out.push({ s: { n: 12, either: false }, bars: [0.0001] }, { s: { n: 12, either: false }, bars: [0.9999] });
  out.push({ s: { n: 5, either: true }, bars: [0.5] }, { s: { n: 4, either: false }, bars: [0.2, 0.9999, 0.0001] });
  return out;
}

/** E[V after the next bar], exactly: the value after is polynomial on each side of the last bar. */
function expectedAfter(bars: number[], s: Settings): number {
  const x = bars[bars.length - 1];
  const after = (y: number) => (survives(bars, y, s.either) ? cashValue([...bars, y], s) : 0);
  return integrate(after, 0, x) + integrate(after, x, 1);
}

// ---------- strategies ----------

/** A rule at a checkpoint: next bar's survival chance, cash-out V (× stake) and whether the next bar is free. */
type Strategy = (safe: number, v: number, free: boolean) => 'cash' | 'next';

const STRATEGIES: { name: string; play: Strategy }[] = [
  { name: '(a) next bar only at ≥ 80% safe', play: (safe) => (safe >= 0.8 ? 'next' : 'cash') },
  { name: '(b) take any profit', play: (_safe, v) => (v > 1 ? 'cash' : 'next') },
  { name: '(c) play to the end', play: () => 'next' },
  // Only ride extreme bars (safe zone ≥ 1/2), always take the free bar, bank a double.
  { name: '(d) bank 2×, else ride only bars ≥ 50% safe', play: (safe, v) => (v >= 2 ? 'cash' : safe >= 0.5 ? 'next' : 'cash') },
];

/** One round as Game.tsx plays it. */
function playRound(s: Settings, play: Strategy, rng: Rng): number {
  const prize = prizeFor(s);
  const bars: number[] = [];
  for (;;) {
    if (bars.length > 0) {
      const v = prize * winChance(bars, s);
      if (play(stepSafe(bars, s.either), v, nextDir(bars, s.either) === 'either') === 'cash') return v;
    }
    const y = rng.next();
    if (!survives(bars, y, s.either)) return 0;
    bars.push(y);
    if (bars.length >= s.n) return prize;
  }
}

/**
 * Exact (to grid error) expected payout of a rule. W_m(z) is the value with m
 * bars left and an up due from z (a down due from x is z = 1 − x); an up from
 * z lands at y ∈ (z, 1), after which a down is due from y, i.e. z' = 1 − y, so
 * the continuation is ∫₀^{1−z} W_{m−1}(t) dt.
 */
function gridValue(s: Settings, play: Strategy, G = 1 << 16): number {
  const prize = prizeFor(s);
  const h = 1 / G;
  const cum = (w: Float64Array) => {
    const c = new Float64Array(G + 1);
    for (let j = 1; j <= G; j++) c[j] = c[j - 1] + ((w[j - 1] + w[j]) * h) / 2;
    return c;
  };
  let W = new Float64Array(G + 1).fill(prize); // m = 0: the board is full
  const last = s.either ? 2 : 1; // the last checkpoint index with a priced (non-free) step from it
  for (let m = 1; m <= s.n - last; m++) {
    const C = cum(W);
    const next = new Float64Array(G + 1);
    for (let i = 0; i <= G; i++) {
      const z = i * h;
      const v = prize * upChance(m, z);
      next[i] = play(1 - z, v, false) === 'cash' ? v : C[G - i];
    }
    W = next;
  }
  if (s.either) {
    // After the first bar x the free bar comes: above x sets up-first (down due
    // from y, z = 1 − y), at or below sets down-first (up due from y, z = y).
    const C = cum(W);
    const E = new Float64Array(G + 1);
    for (let i = 0; i <= G; i++) {
      const x = i * h;
      const v = prize * Math.min(1, upChance(s.n - 1, x) + upChance(s.n - 1, 1 - x));
      E[i] = play(1, v, true) === 'cash' ? v : C[G - i] + C[i];
    }
    W = E;
  }
  return cum(W)[G]; // the first bar is uniform
}

function mc(fn: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = fn(rng);
    s1 += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Zigzag fairness', () => {
  it('the quadrature is exact on the Entringer polynomials', () => {
    // ∫₀¹ u₁₁ = E₁₂ / 12! (André).
    expect(integrate((y) => upChance(11, y), 0, 1)).toBeCloseTo(2702765 / 479001600, 15);
  });

  it('martingale at every sampled state: E[V after the next bar] = V (exact quadrature)', () => {
    const states = varietyOfStates();
    expect(states.length).toBeGreaterThanOrEqual(60);
    for (const { s, bars } of states) {
      const v = cashValue(bars, s);
      expect(Math.abs(expectedAfter(bars, s) - v)).toBeLessThan(1e-10 * prizeFor(s));
      // chanceIfLands (the board's heat bands) is the same post-bar chance.
      const y = bars[bars.length - 1] < 0.5 ? 0.75 : 0.25;
      expect(chanceIfLands(bars, y, s)).toBe(survives(bars, y, s.either) ? (bars.length + 1 >= s.n ? 1 : winChance([...bars, y], s)) : 0);
    }
    // The start: the first bar is free and V before it is RTP.
    for (const s of ALL) expect(integrate((x) => cashValue([x], s), 0, 1)).toBeCloseTo(RTP, 12);
  });

  it('martingale and the displayed safe zone by Monte Carlo through rng.next() (100k samples, 30 states)', () => {
    const rng = createRng(seededSource(77));
    const states = varietyOfStates().filter((_, i) => i % 2 === 0).slice(0, 30);
    expect(states.length).toBe(30);
    const N = 100_000;
    for (const { s, bars } of states) {
      const v = cashValue(bars, s);
      let s1 = 0;
      let s2 = 0;
      let alive = 0;
      for (let i = 0; i < N; i++) {
        const y = rng.next();
        const ok = survives(bars, y, s.either);
        const x = ok ? cashValue([...bars, y], s) : 0;
        if (ok) alive++;
        s1 += x;
        s2 += x * x;
      }
      const mean = s1 / N;
      const se = Math.sqrt((s2 / N - mean * mean) / N);
      expect(Math.abs(mean - v)).toBeLessThan(4 * se + 1e-12);
      const q = stepSafe(bars, s.either);
      expect(Math.abs(alive / N - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / N) + 1e-12);
    }
  });

  it('strategies (a)–(d) return RTP exactly (grid backward induction) on every setting', () => {
    for (const s of ALL) for (const { play } of STRATEGIES) expect(Math.abs(gridValue(s, play, 1 << 13) - RTP)).toBeLessThan(2e-5);
  });

  it('strategies (a)–(d) through the real draws return RTP on every eval config', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      STRATEGIES.forEach(({ name, play }, si) => {
        const exact = gridValue(cfg.params, play);
        expect(Math.abs(exact - RTP)).toBeLessThan(1e-6);
        const { mean, se, max } = mc((rng) => playRound(cfg.params, play, rng), ROUNDS, 9100 + 31 * ci + si);
        rows.push(`${cfg.label} | ${name} | exact ${(exact * 100).toFixed(5)}% | MC ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% | max ${max.toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
