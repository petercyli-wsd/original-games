import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  RTP,
  SHAPES,
  SHAPE_IDS,
  aimedCutChance,
  cutChance,
  direction,
  lineHits,
  offset,
  perimeter,
  prizeFor,
  shadow,
  shadowRange,
  volatilityOf,
  winChance,
  type Pt,
  type Shape,
} from './math';

const rng = createRng(seededSource(11));

/**
 * An independent hit test that never looks at the shadow: intersect the line
 * q + t·v (q = p·u, v ⟂ u) with every edge of the polygon.
 */
function crosses(s: Shape, phi: number, p: number): boolean {
  const u = { x: Math.cos(phi), y: Math.sin(phi) };
  const v = { x: -u.y, y: u.x };
  const q = { x: p * u.x, y: p * u.y };
  const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
  return s.verts.some((a, i) => {
    const b = s.verts[(i + 1) % s.verts.length];
    const d = { x: b.x - a.x, y: b.y - a.y };
    const den = cross(d, v);
    if (Math.abs(den) < 1e-15) return false;
    const lambda = cross({ x: q.x - a.x, y: q.y - a.y }, v) / den;
    return lambda >= 0 && lambda <= 1;
  });
}

/** Mean of f over directions φ in [0, π) by the midpoint rule. */
function meanOverDirections(f: (phi: number) => number, n = 200_000) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(((i + 0.5) / n) * Math.PI);
  return sum / n;
}

const within4se = (hits: number, n: number, p: number) =>
  expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);

describe('Line Cut maths', () => {
  it('every shape sits wholly inside the arena', () => {
    for (const id of SHAPE_IDS) for (const v of SHAPES[id].verts) expect(Math.hypot(v.x, v.y)).toBeLessThan(0.9);
  });

  it('the per-line chances are the advertised ones', () => {
    expect(cutChance(SHAPES.pin)).toBeCloseTo(0.02, 12);
    expect(cutChance(SHAPES.triangle)).toBeCloseTo(0.1, 12);
    expect(cutChance(SHAPES.square)).toBeCloseTo(0.2, 12);
    expect(cutChance(SHAPES.rod)).toBeCloseTo(0.3, 12);
    expect(cutChance(SHAPES.plank)).toBeCloseTo(0.6, 12);
  });

  it('any half-turn of directions gives the same odds: the shadow just flips', () => {
    for (const id of SHAPE_IDS) {
      for (let i = 0; i < 200; i++) {
        const phi = direction(rng.next());
        const a = shadow(SHAPES[id], phi);
        const b = shadow(SHAPES[id], phi + Math.PI);
        expect(b.lo).toBeCloseTo(-a.hi, 12);
        expect(b.hi).toBeCloseTo(-a.lo, 12);
      }
    }
    expect(direction(0)).toBeCloseTo(-Math.PI / 2, 15);
    expect(offset(0)).toBe(-1);
  });

  it('the direction matters for every shape: the printed shadow range is the true one', () => {
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 36_000; i++) {
        const sh = aimedCutChance(s, direction(i / 36_000));
        lo = Math.min(lo, sh);
        hi = Math.max(hi, sh);
      }
      const r = shadowRange(s);
      expect(Math.abs(lo - r.lo)).toBeLessThan(1e-4);
      expect(Math.abs(hi - r.hi)).toBeLessThan(1e-4);
      // No shape casts the same shadow from every side.
      expect(r.hi / Math.max(r.lo, 1e-12)).toBeGreaterThan(1.4);
    }
    expect(shadowRange(SHAPES.rod).lo).toBeLessThan(1e-12);
    expect(shadowRange(SHAPES.rod).hi).toBeCloseTo((0.3 * Math.PI) / 2, 12);
  });

  it('Cauchy: the mean shadow over all directions is perimeter / π', () => {
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      const meanWidth = meanOverDirections((phi) => 2 * aimedCutChance(s, phi));
      expect(Math.abs(meanWidth - perimeter(s) / Math.PI)).toBeLessThan(1e-9);
    }
  });

  it('Crofton: a random line cuts each shape perimeter / 2π of the time (raw simulation)', () => {
    const n = 60_000;
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      let hits = 0;
      for (let i = 0; i < n; i++) if (crosses(s, direction(rng.next()), offset(rng.next()))) hits++;
      within4se(hits, n, winChance(id));
    }
  });

  it('the drawn shadow is exactly the set of offsets whose line cuts the shape', () => {
    const N = 4000;
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      for (let trial = 0; trial < 40; trial++) {
        const phi = rng.next() * Math.PI;
        const { lo, hi } = shadow(s, phi);
        let hits = 0;
        let wrong = 0;
        for (let i = 0; i < N; i++) {
          const p = -1 + (2 * (i + 0.5)) / N;
          const hit = crosses(s, phi, p);
          if (hit) hits++;
          // Away from the shadow's ends, inside the drawn band ⇔ the line cuts the shape.
          if (Math.min(Math.abs(p - lo), Math.abs(p - hi)) > 1e-9 && hit !== (p > lo && p < hi)) wrong++;
          if (lineHits(s, phi, p) !== (p >= lo && p <= hi)) wrong++;
        }
        expect(wrong).toBe(0);
        // The share of the ruler under the shadow is the chance on screen.
        expect(Math.abs(hits / N - aimedCutChance(s, phi))).toBeLessThan(2 / N + 1e-12);
      }
    }
  });

  it('every reveal is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      const prize = prizeFor(id);
      // Start: the stake's worth is RTP.
      expect(prize * winChance(id)).toBeCloseTo(RTP, 14);
      // Direction reveal: averaging the aimed value prize × s over φ gives back RTP.
      const afterAim = meanOverDirections((phi) => prize * aimedCutChance(s, phi), 50_000);
      expect(Math.abs(afterAim - RTP)).toBeLessThan(1e-9);
      // Offset reveal: the line cuts with chance s (pays the prize), else pays 0.
      for (let trial = 0; trial < 20; trial++) {
        const phi = direction(rng.next());
        const sh = aimedCutChance(s, phi);
        const n = 2000;
        let hits = 0;
        for (let i = 0; i < n; i++) if (lineHits(s, phi, -1 + (2 * (i + 0.5)) / n)) hits++;
        expect(Math.abs((hits / n) * prize - sh * prize)).toBeLessThan((2 / n) * prize + 1e-12);
      }
    }
  });

  it('the shape knob moves the win chance over at least 25:1, one shape per level', () => {
    const ps = SHAPE_IDS.map(winChance);
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThanOrEqual(25 - 1e-9);
    expect(new Set(ps.map(volatilityOf))).toEqual(new Set(['low', 'medium', 'high', 'extreme']));
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / 0.02, 9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    const results = runEval(evalSpec, { rounds: 50_000 });
    for (const r of results) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
