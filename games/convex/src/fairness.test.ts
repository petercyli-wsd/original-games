// Fairness audit: can any way of playing Convex beat the RTP?
//
// The tester's claim: "after the free dots you can always cash out at 99, so
// drop only when the next dot is ≥ 80% green and you come out ahead." The only
// decision in a round is when to stop (the dot count is fixed at the bet, the
// auto-drop rules are stopping rules), so the claim fails exactly when the
// cash-out is a martingale: surviving a drop with red share q multiplies the
// cash-out by 1/(1 − q), and q must be the true chance that drop() loses.
//
// The martingale check samples the next drop at each state exactly as
// Game.tsx's drop() does (zones → samplePoint(rng.next) → landsSafe on the
// zones hull), 100k times, and compares E[cash-out after the drop] with the
// cash-out now. States come from random rounds, plus hand-built near-cap
// states (dots hugging the square's corners, where green is a few thin
// slivers and the factor is huge).
//
// Strategies, per eval config (dots to place):
//   (a) the tester's: drop while the next dot is ≥ 80% green, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) drop to the end (the max-win auto-cash still applies);
//   (d) geometry-aware: stop when the hull already covers ≥ 40% of the square
//       or the next drop is < 60% green, but keep going once the cash-out
//       passes 5× (chasing a big finish);
// each played on the real functions, with the game's max-win rule. The
// payouts are heavy-tailed for (c) on 7–8 dots, so their standard error is
// set by variance, not by bias: the martingale check is the binding test.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { FREE_DROPS, MAX_WIN, RTP, afterSafeDrop, hitsCap, hull, landsSafe, polygonArea, samplePoint, zones, type Pt, type Target } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);
/** Samples of the next drop per martingale state. */
const SAMPLES = 100_000;

interface State {
  points: Pt[];
  cash: number;
}

/** Stop rule at a checkpoint: given the dots, cash-out and red share of the next drop, cash out now? */
type Stop = (s: State, q: number) => boolean;

/**
 * One round exactly as Game.tsx plays it: three free drops, then at each
 * checkpoint the max-win auto-cash, the player's stop rule, else drop.
 */
function playRound(target: Target, stop: Stop, rng: Rng): number {
  const points: Pt[] = [];
  let cash = RTP;
  for (;;) {
    const z = zones(points);
    const p = samplePoint(rng.next);
    if (!landsSafe(z.hull, p)) return 0;
    points.push(p);
    cash = afterSafeDrop(cash, z.q);
    if (points.length >= target) return cash;
    if (points.length < FREE_DROPS) continue;
    const nq = zones(points).q;
    if (hitsCap(cash, nq)) return cash;
    if (stop({ points, cash }, nq)) return cash;
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop while ≥ 80% green', stop: (_, q) => 1 - q < 0.8 },
  { name: '(b) take any profit', stop: (s) => s.cash > 1 },
  { name: '(c) drop to the end', stop: () => false },
  { name: '(d) hull ≥ 40% or < 60% green, chase past 5×', stop: (s, q) => s.cash < 5 && (polygonArea(hull(s.points)) >= 0.4 || 1 - q < 0.6) },
];

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

/** Checkpoints met while playing random rounds to the end (8 dots), cash-outs as the game computes them. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const points: Pt[] = [];
    let cash = RTP;
    for (;;) {
      const z = zones(points);
      const p = samplePoint(rng.next);
      if (!landsSafe(z.hull, p)) break;
      points.push(p);
      cash = afterSafeDrop(cash, z.q);
      if (points.length >= 8) break;
      // Keep a varied mix: every state with 3–7 dots, sampled.
      if (points.length >= FREE_DROPS && rng.next() < 0.5) out.push({ points: [...points], cash });
    }
  }
  return out.slice(0, count);
}

/** Dots near the square's corners (a hull that nearly fills it): q close to 1, a huge per-drop factor. */
function cornerState(eps: number, extra: Pt[] = []): State {
  return {
    points: [{ x: eps, y: eps }, { x: 1 - eps, y: 1.5 * eps }, { x: 1 - 2 * eps, y: 1 - eps }, { x: 1.2 * eps, y: 1 - 1.3 * eps }, ...extra],
    cash: RTP,
  };
}

describe('Convex fairness', () => {
  it('martingale: at 30+ reached and near-cap states, E[cash-out after the next drop] = cash-out now (100k drops each, 4 SE)', () => {
    const rng = createRng(seededSource(2024));
    const states = [...reachedStates(30, rng), cornerState(0.01), cornerState(0.003), cornerState(0.02, [{ x: 0.5, y: 0.012 }])];
    const counts = new Set(states.map((s) => s.points.length));
    expect(counts.size).toBeGreaterThanOrEqual(4);

    for (const st of states) {
      const z = zones(st.points);
      // The game would auto-cash here instead of dropping: nothing to check but the cap itself.
      if (hitsCap(st.cash, z.q)) continue;
      let safe = 0;
      for (let i = 0; i < SAMPLES; i++) if (landsSafe(z.hull, samplePoint(rng.next))) safe++;
      // E[V after] = P̂(safe) · cash / (1 − q), against V = cash.
      const pHat = safe / SAMPLES;
      const after = (pHat * afterSafeDrop(st.cash, z.q)) / st.cash;
      const se = Math.sqrt(((1 - z.q) * z.q) / SAMPLES) / (1 - z.q);
      expect(Math.abs(after - 1)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('near the cap: the round auto-cashes before any drop that could pay above MAX_WIN, and never offers a q = 1 drop', () => {
    const rng = createRng(seededSource(99));
    const states = [...reachedStates(40, rng), cornerState(0.01), cornerState(0.001)];
    for (const st of states) {
      const { q } = zones(st.points);
      // Push the cash-out to just under and just over the cap boundary.
      const edge = MAX_WIN * (1 - q);
      for (const cash of [edge * (1 - 1e-9), edge, edge * (1 + 1e-9), st.cash]) {
        if (!hitsCap(cash, q)) {
          expect(q).toBeLessThan(1);
          expect(afterSafeDrop(cash, q)).toBeLessThanOrEqual(MAX_WIN);
        }
      }
    }
  });

  it('the three free drops really are free: three dots are always in convex position', () => {
    const rng = createRng(seededSource(3));
    for (let r = 0; r < 2000; r++) {
      const pts: Pt[] = [];
      for (let k = 0; k < FREE_DROPS; k++) {
        const z = zones(pts);
        expect(z.q).toBe(0);
        const p = samplePoint(rng.next);
        expect(landsSafe(z.hull, p)).toBe(true);
        pts.push(p);
      }
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE, and never pay above MAX_WIN', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ params: { target } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(target, stop, r), ROUNDS, 6100 + 13 * ci + si);
        rows.push(`${target} dots  ${name.padEnd(46)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(1)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_WIN);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
