import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ARENAS,
  RTP,
  SERIES,
  SIDES,
  SQUARE,
  TRIANGLE,
  TRIANGLE_ACUTE,
  acuteChance,
  acuteShare,
  arenaArea,
  bandArea,
  bandPolygon,
  cashOutValue,
  circlePolyArea,
  inArena,
  isAcute,
  obtuseChanceByQuadrature,
  prizeOf,
  samplePoint,
  sideShare,
  stateWinChance,
  thalesArea,
  winChance,
  zoneOf,
  type Arena,
  type Pt,
} from './math';

const rng = createRng(seededSource(11));
const pt = (arena: Arena) => samplePoint(arena, rng.next(), rng.next());

function inConvex(poly: Pt[], p: Pt) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
}

describe('Thales maths', () => {
  it('quadrature reproduces the square closed form, and the stored triangle constant', () => {
    expect(obtuseChanceByQuadrature(SQUARE)).toBeCloseTo(97 / 150 + Math.PI / 40, 12);
    expect(1 - obtuseChanceByQuadrature(TRIANGLE)).toBeCloseTo(TRIANGLE_ACUTE, 12);
    // Stable under refinement.
    expect(obtuseChanceByQuadrature(TRIANGLE, 40)).toBeCloseTo(obtuseChanceByQuadrature(TRIANGLE, 16), 13);
  });

  it('three raw uniform points make an acute triangle as often as the headline says', () => {
    for (const arena of ARENAS) {
      const n = 60_000;
      let hits = 0;
      for (let i = 0; i < n; i++) if (isAcute(pt(arena), pt(arena), pt(arena))) hits++;
      const p = acuteChance(arena);
      expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('samples land uniformly inside the arena', () => {
    for (const arena of ARENAS) {
      for (let i = 0; i < 2000; i++) expect(inArena(arena, pt(arena))).toBe(true);
    }
  });

  it('the exact conditional share averages to the headline (E[r(A, B)] = p)', () => {
    for (const arena of ARENAS) {
      const n = 30_000;
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const r = acuteShare(arena, pt(arena), pt(arena));
        s += r;
        s2 += r * r;
      }
      const mean = s / n;
      const se = Math.sqrt((s2 / n - mean * mean) / n);
      expect(Math.abs(mean - acuteChance(arena))).toBeLessThan(4 * se);
    }
  });

  it('band and Thales-disc areas match a fine grid sweep of the arena', () => {
    const N = 360;
    for (const arena of ARENAS) {
      for (let trial = 0; trial < 6; trial++) {
        const a = pt(arena);
        const b = pt(arena);
        const z = zoneOf(a, b)!;
        let band = 0;
        let disc = 0;
        let acute = 0;
        const cell = 4 / (N * N);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const c = { x: -1 + (2 * (i + 0.5)) / N, y: -1 + (2 * (j + 0.5)) / N };
            if (!inArena(arena, c)) continue;
            const s = (c.x - a.x) * z.u.x + (c.y - a.y) * z.u.y;
            if (s > 0 && s < 2 * z.r) band += cell;
            if (Math.hypot(c.x - z.mid.x, c.y - z.mid.y) < z.r) disc += cell;
            if (isAcute(a, b, c)) acute += cell;
          }
        }
        expect(Math.abs(band - bandArea(arena, a, b))).toBeLessThan(0.03);
        expect(Math.abs(disc - thalesArea(arena, a, b))).toBeLessThan(0.03);
        expect(Math.abs(acute / arenaArea(arena) - acuteShare(arena, a, b))).toBeLessThan(0.01);
      }
    }
  });

  it('circle–polygon area handles discs inside, across and covering the polygon', () => {
    expect(circlePolyArea({ x: 0, y: 0 }, 0.5, SQUARE)).toBeCloseTo(Math.PI / 4, 12);
    expect(circlePolyArea({ x: 0, y: 0 }, 3, SQUARE)).toBeCloseTo(4, 12);
    expect(circlePolyArea({ x: 1, y: 0 }, 0.5, SQUARE)).toBeCloseTo(Math.PI / 8, 12);
    expect(circlePolyArea({ x: 1, y: 1 }, 0.5, SQUARE)).toBeCloseTo(Math.PI / 16, 12);
    // Opposite corners of the square: the circumcircle swallows it, nothing is acute.
    expect(acuteShare('square', { x: -1, y: -1 }, { x: 1, y: 1 })).toBeCloseTo(0, 12);
    // A diameter of the disc: the band is the whole disc and the Thales disc is the arena.
    expect(acuteShare('disc', { x: -1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 12);
  });

  it('the drawn zone (band polygon minus Thales circle) is exactly where C makes it acute', () => {
    for (const arena of ARENAS) {
      for (let trial = 0; trial < 40; trial++) {
        const a = pt(arena);
        const b = pt(arena);
        const z = zoneOf(a, b)!;
        const band = bandPolygon(a, b);
        for (let k = 0; k < 200; k++) {
          const c = pt(arena);
          const drawn = inConvex(band, c) && Math.hypot(c.x - z.mid.x, c.y - z.mid.y) > z.r;
          expect(drawn).toBe(isAcute(a, b, c));
        }
      }
    }
  });

  it('each reveal is a fair bet: E[cash-out after C] = cash-out with A, B down', () => {
    for (const arena of ARENAS) {
      for (const side of SIDES) {
        for (const series of SERIES) {
          const s = { arena, side, series };
          expect(cashOutValue(s, { settled: 0, ab: null })).toBeCloseTo(RTP, 12);
          expect(stateWinChance(s, { settled: 0, ab: null })).toBeCloseTo(winChance(s), 14);
          for (let k = 0; k < series; k++) {
            const a = pt(arena);
            const b = pt(arena);
            const r = sideShare(s, a, b);
            const landed = cashOutValue(s, { settled: k, ab: [a, b] });
            const after = cashOutValue(s, { settled: k + 1, ab: null });
            expect(r * after).toBeCloseTo(landed, 9);
            expect(landed).toBeLessThanOrEqual(prizeOf(s) + 1e-9);
          }
          expect(cashOutValue(s, { settled: series, ab: null })).toBeCloseTo(prizeOf(s), 9);
        }
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
