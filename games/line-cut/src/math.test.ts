import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_SETTINGS,
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
  shadow,
  winChance,
  winChanceAimed,
  winChanceLeft,
  type Pt,
  type Shape,
} from './math';

const rng = createRng(seededSource(11));

/**
 * An independent hit test that never looks at the shadow: intersect the line
 * q + t·v (q = p·u, v ⟂ u) with every edge of the polygon, or measure the
 * disc centre's distance to it.
 */
function crosses(s: Shape, phi: number, p: number): boolean {
  const u = { x: Math.cos(phi), y: Math.sin(phi) };
  const v = { x: -u.y, y: u.x };
  const q = { x: p * u.x, y: p * u.y };
  const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
  if (s.kind === 'disc') return Math.abs(cross({ x: s.c.x - q.x, y: s.c.y - q.y }, v)) <= s.r;
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
  it('lays every shape wholly inside the arena, without overlaps', () => {
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      if (s.kind === 'disc') expect(Math.hypot(s.c.x, s.c.y) + s.r).toBeLessThan(0.9);
      else for (const v of s.verts) expect(Math.hypot(v.x, v.y)).toBeLessThan(0.9);
    }
    // No two shapes' shadows overlap in every direction, so they are disjoint (separating axis).
    for (const a of SHAPE_IDS)
      for (const b of SHAPE_IDS) {
        if (a >= b) continue;
        let separated = false;
        for (let i = 0; i < 720 && !separated; i++) {
          const phi = (i / 720) * Math.PI;
          const x = shadow(SHAPES[a], phi);
          const y = shadow(SHAPES[b], phi);
          separated = x.hi + 0.04 < y.lo || y.hi + 0.04 < x.lo;
        }
        expect(separated, `${a} and ${b} overlap`).toBe(true);
      }
  });

  it('the per-line chances are the advertised ones: rod = circle', () => {
    expect(cutChance(SHAPES.circle)).toBeCloseTo(0.3, 12);
    expect(cutChance(SHAPES.rod)).toBeCloseTo(0.3, 12);
    expect(cutChance(SHAPES.square)).toBeCloseTo(0.2, 12);
    expect(cutChance(SHAPES.triangle)).toBeCloseTo(0.15, 12);
    expect(cutChance(SHAPES.dot)).toBeCloseTo(0.02, 12);
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

  it("the circle's shadow never moves; the rod's swings from 0 to 47%", () => {
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 3600; i++) {
      const phi = direction(i / 3600);
      expect(aimedCutChance(SHAPES.circle, phi)).toBeCloseTo(0.3, 12);
      expect(aimedCutChance(SHAPES.dot, phi)).toBeCloseTo(0.02, 12);
      const r = aimedCutChance(SHAPES.rod, phi);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(lo).toBeLessThan(0.001);
    expect(hi).toBeCloseTo((0.3 * Math.PI) / 2, 5);
  });

  it('Cauchy: the mean shadow over all directions is perimeter / π', () => {
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      const meanWidth = meanOverDirections((phi) => 2 * aimedCutChance(s, phi));
      expect(Math.abs(meanWidth - perimeter(s) / Math.PI)).toBeLessThan(1e-9);
    }
  });

  it('Crofton: random lines hit each shape perimeter / 2π of the time (raw simulation)', () => {
    const n = 60_000;
    for (const id of SHAPE_IDS) {
      const s = SHAPES[id];
      let hits = 0;
      for (let i = 0; i < n; i++) if (crosses(s, direction(rng.next()), offset(rng.next()))) hits++;
      within4se(hits, n, cutChance(s));
    }
  });

  it('whole rounds win exactly as often as the closed form says (raw simulation)', () => {
    const n = 12_000;
    for (const { shape, side, lines } of ALL_SETTINGS) {
      let wins = 0;
      for (let r = 0; r < n; r++) {
        let hit = false;
        for (let k = 0; k < lines && !hit; k++) hit = crosses(SHAPES[shape], direction(rng.next()), offset(rng.next()));
        if (hit === (side === 'hit')) wins++;
      }
      within4se(wins, n, winChance(shape, side, lines));
    }
  });

  it('the drawn shadow is exactly the set of offsets whose line hits the shape', () => {
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
    for (let trial = 0; trial < 40; trial++) {
      const { shape, side, lines } = ALL_SETTINGS[rng.int(ALL_SETTINGS.length)];
      const s = SHAPES[shape];
      const c = cutChance(s);
      const prize = RTP / winChance(shape, side, lines);
      const left = 1 + rng.int(lines); // lines still to cut, all earlier ones missed

      // Direction reveal: averaging the aimed value over φ gives the unaimed value.
      const before = prize * winChanceLeft(side, left, c);
      const afterAim = meanOverDirections((phi) => prize * winChanceAimed(side, left, aimedCutChance(s, phi), c), 50_000);
      expect(Math.abs(afterAim - before)).toBeLessThan(1e-9);

      // Offset reveal: hit with chance s (ends the round), else the next line comes unaimed.
      const phi = rng.next() * Math.PI;
      const sh = aimedCutChance(s, phi);
      const aimed = prize * winChanceAimed(side, left, sh, c);
      const onHit = side === 'hit' ? prize : 0;
      const onMiss = prize * winChanceLeft(side, left - 1, c);
      expect(sh * onHit + (1 - sh) * onMiss).toBeCloseTo(aimed, 12);
    }
  });

  it('Hit and Miss are complementary, and the start is worth RTP', () => {
    for (const { shape, lines } of ALL_SETTINGS) {
      expect(winChance(shape, 'hit', lines) + winChance(shape, 'miss', lines)).toBeCloseTo(1, 14);
      for (const side of ['hit', 'miss'] as const) {
        expect((RTP / winChance(shape, side, lines)) * winChance(shape, side, lines)).toBeCloseTo(RTP, 14);
      }
    }
  });

  it('the controls move the win chance over at least 25:1', () => {
    const ps = ALL_SETTINGS.map((s) => winChance(s.shape, s.side, s.lines));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / 0.02, 9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
