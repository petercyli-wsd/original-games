import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FLOORS,
  HALF_TURN,
  LENGTHS,
  NEEDLES,
  SIDES,
  VOLATILITY,
  arcsLength,
  averageCrossingArcs,
  cashOutValue,
  crossChance,
  crossFraction,
  crosses,
  crossingArcs,
  inArcs,
  MAX_MULTIPLIER,
  onSide,
  prizeOf,
  sideChance,
  sideFraction,
  winArcs,
  winChance,
  type Centre,
  type Floor,
  type Settings,
} from './math';

const rng = createRng(seededSource(11));
const TEST_LENGTHS = [0.1, 0.35, 0.6, 0.85, 1];

/**
 * A needle dropped on an unbounded floor, written independently of the game's
 * code: it touches a horizontal line when its two ends fall in different
 * bands (and a vertical one likewise, on the grid).
 */
function rawDrop(floor: Floor, length: number) {
  const X = 10 * rng.next();
  const Y = 10 * rng.next();
  const t = Math.PI * rng.next();
  const hx = (length / 2) * Math.cos(t);
  const hy = (length / 2) * Math.sin(t);
  const touchesH = Math.floor(Y - hy) !== Math.floor(Y + hy);
  const touchesV = Math.floor(X - hx) !== Math.floor(X + hx);
  return touchesH || (floor === 'grid' && touchesV);
}

/** Composite Simpson's rule on [a, b] with m (even) panels. */
function simpson(g: (x: number) => number, a: number, b: number, m = 200) {
  if (b <= a) return 0;
  const dx = (b - a) / m;
  let sum = g(a) + g(b);
  for (let i = 1; i < m; i++) sum += (i % 2 ? 4 : 2) * g(a + i * dx);
  return (sum * dx) / 3;
}

/**
 * Average of f over a uniform centre in the cell, by quadrature. Each distance
 * to the nearest line (dx, dy) is uniform on [0, ½] (density 2). On [0, h] we
 * substitute d = h·cos φ, which removes the square-root edge of arccos(d/h)
 * (and makes the reach angle α(d) equal φ); on [h, ½] nothing reaches a line,
 * so f is constant there in that variable. On the grid the two bow-ties merge
 * along φx + φy = π/2, so the inner integral is split there. Everything left
 * is smooth, and Simpson's rule is accurate to ~1e-12.
 */
function cellAverage(f: (c: Centre) => number, length: number) {
  const h = length / 2;
  const Q = Math.PI / 2;
  const flatD = (h + 0.5) / 2;
  const flatW = 2 * (0.5 - h);
  // Integral over dy for a fixed dx; kink is where the inner reach angle meets Q − (outer one).
  const inner = (dx: number, kink: number) => {
    const g = (phi: number) => 2 * h * Math.sin(phi) * f({ u: dx, v: h * Math.cos(phi) });
    const k = Math.min(Q, Math.max(0, kink));
    return simpson(g, 0, k) + simpson(g, k, Q) + (flatW > 0 ? flatW * f({ u: dx, v: flatD }) : 0);
  };
  const outer = simpson((phi) => 2 * h * Math.sin(phi) * inner(h * Math.cos(phi), Q - phi), 0, Q, 400);
  return outer + (flatW > 0 ? flatW * inner(flatD, Q) : 0);
}

describe('Needle maths', () => {
  it("Buffon and Laplace: the closed forms match a simulation of dropped needles", () => {
    for (const floor of FLOORS) {
      for (const length of TEST_LENGTHS) {
        const rounds = 40_000;
        let hits = 0;
        for (let r = 0; r < rounds; r++) if (rawDrop(floor, length)) hits++;
        const p = crossChance(floor, length);
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('the staged process (centre, then spin) wins as often as pⁿ says, for every needle count', () => {
    const settings: Settings[] = [
      { floor: 'lines', side: 'cross', length: 0.75, needles: 1 },
      { floor: 'grid', side: 'miss', length: 0.5, needles: 2 },
      { floor: 'lines', side: 'miss', length: 0.9, needles: 3 },
      { floor: 'grid', side: 'cross', length: 0.6, needles: 3 },
    ];
    for (const s of settings) {
      const rounds = 40_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let ok = true;
        for (let k = 0; ok && k < s.needles; k++) ok = onSide(s, { u: rng.next(), v: rng.next() }, Math.PI * rng.next());
        if (ok) wins++;
      }
      const p = winChance(s);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('averaging the drawn fraction over the cell gives back Buffon and Laplace exactly', () => {
    for (const floor of FLOORS) {
      for (const length of TEST_LENGTHS) {
        const avg = cellAverage((c) => crossFraction(floor, length, c), length);
        expect(Math.abs(avg - crossChance(floor, length))).toBeLessThan(1e-9);
      }
    }
  });

  it('the shaded directions are exactly the directions that touch a line (sweep)', () => {
    const N = 2400;
    for (const floor of FLOORS) {
      for (const side of SIDES) {
        for (const length of TEST_LENGTHS) {
          for (let trial = 0; trial < 16; trial++) {
            // Bias half the centres close to a line or a corner, where the arcs are interesting.
            const near = () => (rng.next() < 0.5 ? rng.next() : (rng.next() < 0.5 ? 0 : 1) + (rng.next() - 0.5) * length);
            const c = { u: Math.min(0.999999, Math.max(0, near())), v: Math.min(0.999999, Math.max(0, near())) };
            const s = { floor, side, length };
            const arcs = winArcs(s, c);
            const edges = arcs.flatMap((a) => [a.start, a.end]);
            let wins = 0;
            let mismatches = 0;
            for (let i = 0; i < N; i++) {
              const t = ((i + 0.5) * HALF_TURN) / N;
              const win = onSide(s, c, t);
              if (win) wins++;
              if (win !== inArcs(arcs, t) && edges.every((e) => Math.abs(e - t) > 1e-9)) mismatches++;
            }
            expect(mismatches).toBe(0);
            expect(Math.abs(wins / N - sideFraction(s, c))).toBeLessThan((edges.length + 1) / N);
            expect(arcsLength(arcs) / HALF_TURN).toBeCloseTo(sideFraction(s, c), 12);
            expect(arcsLength(crossingArcs(floor, length, c)) / HALF_TURN).toBeCloseTo(crossFraction(floor, length, c), 12);
          }
        }
      }
    }
  });

  it('the idle dial (average crossing directions) shows exactly the headline chance', () => {
    for (const floor of FLOORS) {
      for (const length of LENGTHS) {
        const arcs = averageCrossingArcs(floor, length);
        expect(arcsLength(arcs) / HALF_TURN).toBeCloseTo(crossChance(floor, length), 12);
        for (let i = 0; i < arcs.length; i++) {
          expect(arcs[i].start).toBeGreaterThanOrEqual(0);
          expect(arcs[i].end).toBeLessThanOrEqual(HALF_TURN);
          if (i > 0) expect(arcs[i].start).toBeGreaterThanOrEqual(arcs[i - 1].end);
        }
      }
    }
  });

  it('each reveal is a fair bet: E[cash-out after] = cash-out before', () => {
    const settings: Settings[] = [
      { floor: 'lines', side: 'cross', length: 0.3, needles: 2 },
      { floor: 'grid', side: 'miss', length: 1, needles: 3 },
      { floor: 'grid', side: 'cross', length: 0.65, needles: 1 },
      { floor: 'lines', side: 'miss', length: 0.85, needles: 3 },
    ];
    for (const s of settings) {
      for (let k = 0; k < s.needles; k++) {
        // The centre drop: average the post-drop cash-out over a uniform centre.
        const before = cashOutValue(s, { settled: k, landed: null });
        const after = cellAverage((c) => cashOutValue(s, { settled: k, landed: c }), s.length);
        expect(Math.abs(after / before - 1)).toBeLessThan(1e-9);

        // The spin: from random centres, win the arcs' share, lose the rest.
        for (let trial = 0; trial < 50; trial++) {
          const c = { u: rng.next(), v: rng.next() };
          const now = cashOutValue(s, { settled: k, landed: c });
          const ifWin = cashOutValue(s, { settled: k + 1, landed: null });
          const share = arcsLength(winArcs(s, c)) / HALF_TURN;
          expect(share * ifWin).toBeCloseTo(now, 9);
        }
      }
      // Before the first reveal the cash-out is the RTP.
      expect(cashOutValue(s, { settled: 0, landed: null })).toBeCloseTo(manifest.rtp, 12);
      expect(cashOutValue(s, { settled: s.needles, landed: null })).toBeCloseTo(prizeOf(s), 9);
    }
  });

  it('a spin from a fixed centre lands on your side as often as the dial says', () => {
    const s = { floor: 'grid' as const, side: 'cross' as const, length: 0.8 };
    for (const c of [
      { u: 0.1, v: 0.3 },
      { u: 0.25, v: 0.12 },
      { u: 0.45, v: 0.5 },
    ]) {
      const rounds = 30_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (crosses(s.floor, s.length, c, Math.PI * rng.next())) wins++;
      const p = sideFraction(s, c);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-12);
    }
  });

  it('maxMultiplier is the largest prize on offer', () => {
    let max = 0;
    for (const floor of FLOORS)
      for (const side of SIDES)
        for (const length of LENGTHS) for (const needles of NEEDLES) max = Math.max(max, prizeOf({ floor, side, length, needles }));
    expect(MAX_MULTIPLIER).toBe(max);
    expect(manifest.maxMultiplier).toBe(max);
    for (const s of Object.values(VOLATILITY)) expect(prizeOf(s)).toBeLessThanOrEqual(manifest.maxMultiplier);
    // The settings span far more than 25:1 in win chance.
    const chances = FLOORS.flatMap((floor) => SIDES.flatMap((side) => LENGTHS.map((length) => sideChance({ floor, side, length }))));
    expect(Math.max(...chances) / Math.min(...chances) ** 3).toBeGreaterThan(25);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
