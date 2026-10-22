import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  HIDDEN,
  MAX_MULTIPLIER,
  RANGES,
  RTP,
  SIDES,
  acCdf,
  cashOut,
  decided,
  draw,
  isReal,
  mapV,
  missHalfWidth,
  noRealOutline,
  pReal0,
  pReal1,
  pReal2,
  polygonArea,
  prize,
  pWin,
  roots,
  rulerBand,
  vertex,
} from './math';

const rng = createRng(seededSource(11));

/** Gauss–Legendre nodes and weights on [−1, 1] (Newton on P_n). */
function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k];
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}
const GL = gaussLegendre(24);

/** ∫ f over [lo, hi], composite Gauss–Legendre. */
function integrate(f: (t: number) => number, lo: number, hi: number, panels = 8): number {
  if (hi <= lo) return 0;
  let s = 0;
  const h = (hi - lo) / panels;
  for (let j = 0; j < panels; j++) {
    const m = lo + (j + 0.5) * h;
    for (let i = 0; i < GL.x.length; i++) s += GL.w[i] * f(m + (GL.x[i] * h) / 2);
  }
  return (s * h) / 2;
}

/** E[g(v)] for v uniform on (0, 1). v = w² removes the √v kinks; the pieces are split at the kink. */
function meanOverUnit(g: (v: number) => number, kink: number): number {
  const k = Math.min(1, Math.max(0, kink));
  const sub = (lo: number, hi: number) => integrate((w) => 2 * w * g(w * w), Math.sqrt(lo), Math.sqrt(hi));
  return sub(0, k) + sub(k, 1);
}

describe('Roots maths', () => {
  it('B = 1 gives the classic (41 + 6 ln 2)/72, and B ≥ 2 gives 4/(9B) for no real roots', () => {
    expect(pReal0(1)).toBeCloseTo((41 + 6 * Math.log(2)) / 72, 14);
    for (const B of RANGES.filter((r) => r >= 2)) expect(1 - pReal0(B)).toBeCloseTo(4 / (9 * B), 14);
  });

  it('the closed form matches a direct simulation of random quadratics (4 SE)', () => {
    for (const B of RANGES) {
      const n = 150_000;
      let real = 0;
      for (let i = 0; i < n; i++) {
        const a = draw(rng.next(), 1);
        const c = draw(rng.next(), 1);
        const b = draw(rng.next(), B);
        if (isReal(a, b, c)) real++;
      }
      const p = pReal0(B);
      expect(Math.abs(real / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('after a, the formula matches a simulation over c and b (4 SE)', () => {
    for (const B of [0.5, 1, 4, 32]) {
      for (const a of [0.04, -0.3, 0.8]) {
        const n = 60_000;
        let real = 0;
        for (let i = 0; i < n; i++) if (isReal(a, draw(rng.next(), B), draw(rng.next(), 1))) real++;
        const p = pReal1(a, B);
        expect(Math.abs(real / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
      }
    }
  });

  it('the distribution of ac (the stretched axis of the odds map) matches a simulation', () => {
    const n = 200_000;
    const qs = [-0.6, -0.1, -0.01, 0, 0.02, 0.25, 0.7];
    const counts = qs.map(() => 0);
    for (let i = 0; i < n; i++) {
      const p = draw(rng.next(), 1) * draw(rng.next(), 1);
      qs.forEach((q, j) => p <= q && counts[j]++);
    }
    qs.forEach((q, j) => {
      const F = acCdf(q);
      expect(Math.abs(counts[j] / n - F)).toBeLessThan(4 * Math.sqrt((F * (1 - F)) / n) + 1e-9);
    });
  });

  it('each reveal is a fair bet: E[cash-out after] = cash-out now (to 1e-9)', () => {
    for (const B of RANGES) {
      for (const side of SIDES) {
        // Reveal a: |a| is uniform on (0, 1), and the chance depends on |a| only.
        const before = cashOut(side, HIDDEN, B);
        expect(before).toBeCloseTo(RTP, 12);
        const afterA = meanOverUnit((v) => cashOut(side, { a: v, c: null, b: null }, B), (B * B) / 4);
        expect(Math.abs(afterA - before)).toBeLessThan(1e-9);

        for (let trial = 0; trial < 12; trial++) {
          // Reveal c at a random reachable a: half the time c has a's sign.
          const a = draw(rng.next(), 1);
          const now = cashOut(side, { a, c: null, b: null }, B);
          const opposite = cashOut(side, { a, c: -Math.sign(a) * 0.5, b: null }, B);
          const same = meanOverUnit((v) => cashOut(side, { a, c: Math.sign(a) * v, b: null }, B), (B * B) / (4 * Math.abs(a)));
          expect(Math.abs(0.5 * opposite + 0.5 * same - now)).toBeLessThan(1e-9);

          // Reveal b at a random reachable (a, c): the payout is the prize on the
          // side's zone of the ruler and 0 elsewhere, so the mean is prize × zone share.
          const c = draw(rng.next(), 1);
          const mid = cashOut(side, { a, c, b: null }, B);
          const h = rulerBand(a, c, B);
          const zone = side === 'real' ? 1 - h : h;
          expect(Math.abs(zone * prize(side, B) - mid)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('the b-ruler drawn after c is exactly where b gives real roots', () => {
    for (const B of RANGES) {
      for (let trial = 0; trial < 30; trial++) {
        const a = draw(rng.next(), 1);
        const c = draw(rng.next(), 1);
        const h = rulerBand(a, c, B);
        const N = 4000;
        let real = 0;
        let misplaced = 0;
        for (let i = 0; i < N; i++) {
          const u = -1 + (2 * (i + 0.5)) / N;
          const r = isReal(a, u * B, c);
          if (r) real++;
          // Every sample away from the band edges sits in the zone the board paints.
          if (Math.abs(Math.abs(u) - h) > 2 / N && r !== Math.abs(u) >= h) misplaced++;
        }
        expect(misplaced).toBe(0);
        expect(Math.abs(real / N - pReal2(a, c, B))).toBeLessThan(2 / N + 1e-12);
      }
    }
  });

  it('the shaded share of the odds map is the true chance, before a and after a', () => {
    for (const B of RANGES) {
      // Before a: the stretched box.
      expect(Math.abs(polygonArea(noRealOutline(B, 0, 1, 4000)) / 2 - (1 - pReal0(B)))).toBeLessThan(2e-6);
      // The coarser outline that is drawn is still accurate to a fraction of a percent.
      expect(Math.abs(polygonArea(noRealOutline(B, 0, 1)) / 2 - (1 - pReal0(B)))).toBeLessThan(1e-3);
      for (let trial = 0; trial < 10; trial++) {
        const a = draw(rng.next(), 1);
        const alpha = Math.abs(a);
        expect(Math.abs(polygonArea(noRealOutline(B, 1, alpha, 4000)) / 2 - (1 - pReal1(a, B)))).toBeLessThan(2e-6);
        expect(Math.abs(polygonArea(noRealOutline(B, 1, alpha)) / 2 - (1 - pReal1(a, B)))).toBeLessThan(1e-3);
      }
    }
  });

  it('a point of the odds map is inside the cup exactly when the quadratic has no real roots', () => {
    for (let i = 0; i < 4000; i++) {
      const B = RANGES[rng.int(RANGES.length)];
      const a = draw(rng.next(), 1);
      const c = draw(rng.next(), 1);
      const b = draw(rng.next(), B);
      // Above the cup at this b means v(ac) > v(b²/4); v is increasing, so it is ac > b²/4.
      for (const zoom of [0, 1]) {
        const inside = mapV(a * c, zoom, Math.abs(a)) > mapV((b * b) / 4, zoom, Math.abs(a));
        if (Math.abs(a * c - (b * b) / 4) > 1e-9) expect(inside).toBe(!isReal(a, b, c));
      }
    }
  });

  it('the odds map puts ac = 0 in the middle before a and the box edges at ±|a| after a', () => {
    expect(mapV(0, 0, 0.3)).toBeCloseTo(0.5, 12);
    expect(mapV(-1, 0, 0.3)).toBeCloseTo(0, 12);
    expect(mapV(1, 0, 0.3)).toBeCloseTo(1, 12);
    expect(mapV(-0.3, 1, 0.3)).toBeCloseTo(0, 12);
    expect(mapV(0.3, 1, 0.3)).toBeCloseTo(1, 12);
  });

  it('roots are real exactly when the discriminant is non-negative, and solve the quadratic', () => {
    for (let i = 0; i < 2000; i++) {
      const a = draw(rng.next(), 1);
      const b = draw(rng.next(), 8);
      const c = draw(rng.next(), 1);
      const rs = roots(a, b, c);
      expect(rs.length > 0).toBe(isReal(a, b, c));
      for (const x of rs) expect(Math.abs(a * x * x + b * x + c)).toBeLessThan(1e-9 * (1 + Math.abs(b * x) + Math.abs(a * x * x) + Math.abs(c)));
      // The vertex sits on the far side of the line from the opening exactly when roots are real.
      const v = vertex(a, b, c);
      if (Math.abs(v.y) > 1e-9) expect(Math.sign(a) * v.y <= 0).toBe(isReal(a, b, c));
      expect(missHalfWidth(a, c) > Math.abs(b)).toBe(!isReal(a, b, c) && a * c > 0);
    }
  });

  it('a reveal that settles the bet is detected, and the round never offers a certain step', () => {
    expect(decided({ a: 0.5, c: -0.2, b: null }, 1)).toBe(true); // ac < 0: real for sure
    expect(decided({ a: 0.9, c: 0.9, b: null }, 1)).toBe(true); // 2√(ac) = 1.8 ≥ B: never real
    expect(decided({ a: 0.5, c: 0.2, b: null }, 1)).toBe(false);
    expect(decided({ a: 0.5, c: null, b: null }, 0.5)).toBe(false);
  });

  it('prizes and the max multiplier are honest', () => {
    for (const B of RANGES) {
      for (const side of SIDES) {
        expect(cashOut(side, HIDDEN, B)).toBeCloseTo(RTP, 12);
        expect(prize(side, B)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
        expect(pWin(side, HIDDEN, B)).toBeGreaterThan(0);
      }
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 72, 9);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('the settings move the win chance over more than 25:1', () => {
    const ps = RANGES.flatMap((B) => SIDES.map((s) => pWin(s, HIDDEN, B)));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    const reports = runEval(evalSpec, { rounds: 50_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    const stds = reports.map((r) => r.stdDev);
    expect(Math.max(...stds) / Math.min(...stds)).toBeGreaterThan(5);
  });
});
