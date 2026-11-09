// Fairness audit: can any way of playing Half Moon beat the RTP?
//
// The only decision in a round is when to stop: window and points-to-fill
// are locked while live, the first point drops with the bet, and each later
// drop is offered only at a checkpoint (Cash out and Drop next exist only
// there; Space and C call the same drop() / cashOut()). Surviving a drop with
// bust chance q multiplies the cash-out by 1/(1 − q), so the value is a
// martingale exactly when q is the true chance that the drop busts.
//
// Martingale check, on the real danger() / fits() / afterSafeDrop():
//   - exact: fits(points + p) is piecewise constant in p, changing only where
//     p crosses a point or sits L = 1 − window from one (where a new gap
//     equals L). Testing the midpoint of every piece gives the exact bust
//     measure, which must equal q (to 1e-9), at 40+ reached states (all four
//     windows and targets, one point short of full included) and hand-built
//     near-cap states (largest gap just above L, so q ≈ L and the factor ≈ 1/a);
//   - sampled: 100k drops with the seeded RNG at a subset of states, 4 SE.
//
// Strategies, per eval config, on the same functions in Game.tsx's order:
//   (a) drop while the next drop is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) drop to the full board;
//   (d) pick the risks: take the second drop (on 90° / 120° it is a fixed
//       50% / 33% risk, so any "skip big arcs" rule would stop there at
//       0.99), then cash out when q > 20% while under 3×, and always drop
//       once at 3× or more.
// (a) on the 90° and 120° windows always cashes at 0.99 after the first
// point: the second drop is only 50% / 67% safe.
// Column (c) on the high/extreme configs is heavy-tailed (prizes up to
// ~16,000×), so its standard error is set by variance; the exact martingale
// check is the binding test there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, WINDOWS, afterSafeDrop, danger, fits, maxMultiplier, type Target, type Window } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;

interface State {
  window: Window;
  target: Target;
  points: number[];
  cash: number;
}

type Stop = (s: State, q: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop while ≥ 80% safe', stop: (_, q) => 1 - q < 0.8 },
  { name: '(b) take any profit', stop: (s) => s.cash > 1 },
  { name: '(c) drop to the full board', stop: () => false },
  { name: '(d) skip q > 20% under 3×, chase over', stop: (s, q) => s.points.length >= 2 && s.cash < 3 && q > 0.2 },
];

/** One round as Game.tsx plays it: the bet drops the first point, then checkpoint → stop or drop, auto-cash when full. */
function playRound(window: Window, target: Target, stop: Stop, rng: Rng): number {
  const s: State = { window, target, points: [], cash: RTP };
  for (;;) {
    const { q } = danger(s.points, window);
    const p = rng.next();
    const points = [...s.points, p];
    if (!fits(points, window)) return 0;
    s.cash = afterSafeDrop(s.cash, q);
    s.points = points;
    if (points.length >= target) return s.cash;
    if (stop(s, danger(points, window).q)) return s.cash;
  }
}

/** Exact measure of landing spots p ∈ [0, 1) for which fits(points + p) fails. */
function exactBust(points: number[], window: Window): number {
  const L = 1 - window / 360;
  const mod1 = (x: number) => ((x % 1) + 1) % 1;
  const cuts = [0, 1, ...points.flatMap((x) => [x, mod1(x + L), mod1(x - L)])].sort((a, b) => a - b);
  let bust = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    if (b - a < 1e-15) continue;
    if (!fits([...points, (a + b) / 2], window)) bust += b - a;
  }
  return bust;
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

/** Checkpoints met while playing random rounds to the end, cash-outs as the game computes them. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const window = WINDOWS[out.length % WINDOWS.length];
    const target = TARGETS[rng.int(TARGETS.length)];
    const s: State = { window, target, points: [], cash: RTP };
    for (;;) {
      const { q } = danger(s.points, window);
      const points = [...s.points, rng.next()];
      if (!fits(points, window)) break;
      s.points = points;
      s.cash = afterSafeDrop(s.cash, q);
      if (points.length >= target) break;
      // A checkpoint: keep about half, and always the last one before a full board.
      if (rng.next() < 0.5 || points.length === target - 1) out.push({ ...s, points: [...points] });
    }
  }
  return out.slice(0, count);
}

/** Two points a hair under L apart the long way round: the largest gap is just over L, so q ≈ L. */
function nearCap(window: Window, eps: number, target: Target = 8): State {
  const a = window / 360;
  return { window, target, points: [0.1, 0.1 + a - eps, 0.1 + (a - eps) / 2], cash: RTP };
}

describe('Half Moon fairness', () => {
  it('martingale (exact): at 40+ reached and near-cap states the red arc q is the exact bust measure, so E[V after a drop] = V', () => {
    const rng = createRng(seededSource(1717));
    const states = [
      ...reachedStates(44, rng),
      ...WINDOWS.flatMap((w) => [nearCap(w, 1e-3), nearCap(w, 1e-7)]),
      // Single point: the second drop (free for windows ≥ 180°, q = 1 − 2a below).
      ...WINDOWS.map((w) => ({ window: w, target: 4 as Target, points: [0.37], cash: RTP })),
    ];
    expect(new Set(states.map((s) => s.points.length)).size).toBeGreaterThanOrEqual(5);
    // Not vacuous: most states have a real red arc, some of it large.
    expect(states.filter((s) => danger(s.points, s.window).q > 0).length).toBeGreaterThanOrEqual(25);
    expect(states.filter((s) => danger(s.points, s.window).q > 0.4).length).toBeGreaterThanOrEqual(5);
    for (const s of states) {
      const { q } = danger(s.points, s.window);
      expect(Math.abs(exactBust(s.points, s.window) - q)).toBeLessThan(1e-9);
      // E[V after] = (1 − q)·V/(1 − q) + q·0 = V, and the factor stays within the manifest's bound.
      if (q < 1) expect(afterSafeDrop(s.cash, q) * (1 - q)).toBeCloseTo(s.cash, 12);
      expect(q).toBeLessThanOrEqual(1 - s.window / 360 + 1e-12);
    }
  });

  it('martingale (sampled): 100k real drops at a spread of states match q within 4 SE', () => {
    const rng = createRng(seededSource(99));
    const states = [...reachedStates(10, rng), nearCap(90, 1e-3), nearCap(180, 0.05)];
    for (const s of states) {
      const { q } = danger(s.points, s.window);
      let bust = 0;
      for (let i = 0; i < SAMPLES; i++) if (!fits([...s.points, rng.next()], s.window)) bust++;
      const se = Math.sqrt((q * (1 - q)) / SAMPLES);
      expect(Math.abs(bust / SAMPLES - q)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { window, target } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(window, target, stop, r), ROUNDS, 5100 + 13 * ci + si);
        rows.push(`${label.padEnd(26)} ${name.padEnd(38)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(1)}×`);
        // + 1e-9: (a) on the 90° and 120° windows always cashes at 0.99 after the first point (se = 0), and the float sum drifts ~1e-12.
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(maxMultiplier(window, target) + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
