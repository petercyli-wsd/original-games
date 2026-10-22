import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ARENAS,
  FREE_DROPS,
  MAX_WIN,
  RTP,
  TARGETS,
  afterSafeDrop,
  arenaArea,
  arenaPolygon,
  convexChance,
  cross,
  edgesBeyond,
  hitsCap,
  hull,
  inConvexPosition,
  landsSafe,
  polygonArea,
  samplePoint,
  newWedge,
  swallowed,
  zones,
  type Arena,
  type Pt,
} from './math';

const rng = createRng(seededSource(11));
const within4SE = (hits: number, n: number, p: number) => Math.abs(hits / n - p) < 4 * Math.sqrt((p * (1 - p)) / n) + 1e-9;

/** A reachable state: k points in convex position, dropped one at a time. */
function reachable(arena: Arena, k: number): Pt[] {
  for (;;) {
    const pts: Pt[] = [];
    while (pts.length < k) {
      const p = samplePoint(arena, rng.next);
      if (!landsSafe(hull(pts), p)) break;
      pts.push(p);
    }
    if (pts.length === k) return pts;
  }
}

const inside = (poly: readonly Pt[], p: Pt) => poly.every((a, i) => cross(a, poly[(i + 1) % poly.length], p) >= 0);

describe('Convex maths', () => {
  it("Valtr's formula: known values (Sylvester's four-point problem)", () => {
    for (const arena of ARENAS) for (let n = 1; n <= 3; n++) expect(convexChance(n, arena)).toBe(1);
    expect(convexChance(4, 'square')).toBeCloseTo(25 / 36, 14);
    expect(convexChance(4, 'triangle')).toBeCloseTo(2 / 3, 14);
    expect(convexChance(5, 'square')).toBeCloseTo((70 / 120) ** 2, 14);
    expect(convexChance(8, 'square')).toBeCloseTo((3432 / 40320) ** 2, 14);
    expect(convexChance(5, 'triangle')).toBeCloseTo((32 * 479001600) / (24 ** 3 * 3628800), 14);
  });

  it('the headline odds match a direct simulation of the raw process', () => {
    for (const arena of ARENAS) {
      for (const n of TARGETS) {
        const rounds = 12_000;
        let raw = 0;
        let game = 0;
        for (let r = 0; r < rounds; r++) {
          // Raw definition: n uniform points, all corners of their hull.
          if (inConvexPosition(Array.from({ length: n }, () => samplePoint(arena, rng.next)))) raw++;
          // The game's rule: drop until the first point that is not safe.
          const pts: Pt[] = [];
          while (pts.length < n) {
            const p = samplePoint(arena, rng.next);
            if (!landsSafe(hull(pts), p)) break;
            pts.push(p);
          }
          if (pts.length === n) game++;
        }
        const p = convexChance(n, arena);
        expect(within4SE(raw, rounds, p), `${arena} n=${n} raw ${raw / rounds} vs ${p}`).toBe(true);
        expect(within4SE(game, rounds, p), `${arena} n=${n} game ${game / rounds} vs ${p}`).toBe(true);
      }
    }
  });

  it('the samplers are uniform on the arena', () => {
    for (const arena of ARENAS) {
      const poly = arenaPolygon(arena);
      const rounds = 20_000;
      let left = 0;
      let outside = 0;
      for (let r = 0; r < rounds; r++) {
        const p = samplePoint(arena, rng.next);
        if (!inside(poly, p)) outside++;
        if (p.x < 0.5) left++;
      }
      expect(outside).toBe(0);
      expect(within4SE(left, rounds, 0.5)).toBe(true);
    }
  });

  it('the drawn red area is exactly where the next point busts (grid sweep)', () => {
    const N = 220;
    for (const arena of ARENAS) {
      const poly = arenaPolygon(arena);
      for (let trial = 0; trial < 6; trial++) {
        const pts = reachable(arena, FREE_DROPS + (trial % 6));
        const { hull: h, caps, q } = zones(pts, arena);
        expect(h.length).toBe(pts.length);
        // Caps lie in the arena and are disjoint, so their areas add up.
        for (const cap of caps) for (const v of cap) expect(inside(poly, v) || poly.some((a, i) => Math.abs(cross(a, poly[(i + 1) % poly.length], v)) < 1e-12)).toBe(true);
        expect(q).toBeCloseTo(1 - caps.reduce((s, c) => s + polygonArea(c), 0) / arenaArea(arena), 12);

        const lines = h.map((a, i) => [a, h[(i + 1) % h.length]] as const);
        let cells = 0;
        let bust = 0;
        let ruleMismatch = 0;
        let drawnMismatch = 0;
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const p = { x: (i + 0.5) / N, y: (j + 0.5) / N };
            if (!inside(poly, p)) continue;
            cells++;
            const rawBust = !inConvexPosition([...pts, p]);
            if (rawBust) bust++;
            const far = lines.every(([a, b]) => Math.abs(cross(a, b, p)) / Math.hypot(b.x - a.x, b.y - a.y) > 1.5 / N);
            if (!far) continue;
            // The game's rule, the drawn caps and the raw definition agree.
            if (landsSafe(h, p) === rawBust) ruleMismatch++;
            if (caps.some((c) => inside(c, p)) === rawBust) drawnMismatch++;
          }
        }
        expect(ruleMismatch).toBe(0);
        expect(drawnMismatch).toBe(0);
        expect(Math.abs(bust / cells - q)).toBeLessThan(4e-3);
      }
    }
  });

  it('swallowed corners are exactly the corners the new point knocks off the hull', () => {
    for (const arena of ARENAS) {
      for (let trial = 0; trial < 200; trial++) {
        const pts = reachable(arena, 3 + (trial % 5));
        const h = hull(pts);
        const p = samplePoint(arena, rng.next);
        const after = hull([...pts, p]);
        const lost = pts.filter((v) => !after.includes(v));
        if (edgesBeyond(h, p) === 0) continue; // inside: p itself is the non-corner
        expect(new Set(swallowed(h, p))).toEqual(new Set(lost));
        // A safe point slots in between the two ends of the one edge it is beyond.
        if (landsSafe(h, p) && h.length >= 3) {
          const i = h.findIndex((v, k) => cross(v, h[(k + 1) % h.length], p) < 0);
          expect(newWedge(after, p)).toEqual([h[i], p, h[(i + 1) % h.length]]);
        }
      }
    }
  });

  it('each drop is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const arena of ARENAS) {
      for (let trial = 0; trial < 40; trial++) {
        const pts = reachable(arena, FREE_DROPS + (trial % 5));
        const { q } = zones(pts, arena);
        const before = RTP * (1 + rng.next() * 20);
        // Exactly: survive with 1 − q and get before / (1 − q), else 0.
        expect((1 - q) * afterSafeDrop(before, q) + q * 0).toBeCloseTo(before, 9);
      }
      // And against the raw process at several reachable states: drop a uniform point,
      // pay before/(1 − q) if all points are still corners (raw hull test), else 0.
      for (let trial = 0; trial < 6; trial++) {
        const pts = reachable(arena, FREE_DROPS + (trial % 4));
        const { q } = zones(pts, arena);
        const before = RTP * (1 + trial);
        const rounds = 12_000;
        let sum = 0;
        let sum2 = 0;
        for (let r = 0; r < rounds; r++) {
          const after = inConvexPosition([...pts, samplePoint(arena, rng.next)]) ? afterSafeDrop(before, q) : 0;
          sum += after;
          sum2 += after * after;
        }
        const mean = sum / rounds;
        const se = Math.sqrt((sum2 / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - before), `${arena} state ${trial}: ${mean} vs ${before}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });

  it('the max-win stop never lets a payout pass the cap', () => {
    expect(hitsCap(MAX_WIN / 2, 0.4)).toBe(false);
    expect(hitsCap(MAX_WIN / 2, 0.6)).toBe(true);
    expect(hitsCap(1, 1)).toBe(true);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under mixed strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
