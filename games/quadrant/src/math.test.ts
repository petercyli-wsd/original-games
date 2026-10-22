import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ANGLES,
  MAX_MULTIPLIER,
  POINTS,
  Phi,
  RTP,
  SLICES,
  SLICE_DEG,
  TARGETS,
  bell,
  bellShare,
  cashOut,
  cloudPoint,
  condY,
  cosDeg,
  drawX,
  drawY,
  fan,
  greenSlices,
  inTarget,
  missWedges,
  normal,
  pLandGivenX,
  pPoint,
  pWin,
  pWin0,
  phi,
  polygonArea,
  prize,
  quadrantChances,
  rhoOf,
  roundAngle,
  settles,
  sheppard,
  sinDeg,
  targetWedges,
  type Settings,
} from './math';

const rng = createRng(seededSource(31));

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
function integrate(f: (t: number) => number, lo: number, hi: number, panels = 40): number {
  if (hi <= lo) return 0;
  let s = 0;
  const h = (hi - lo) / panels;
  for (let j = 0; j < panels; j++) {
    const m = lo + (j + 0.5) * h;
    for (let i = 0; i < GL.x.length; i++) s += GL.w[i] * f(m + (GL.x[i] * h) / 2);
  }
  return (s * h) / 2;
}

/** E[g(X)] for X standard normal, split at 0 where the pay-offs have their kink. */
const normalMean = (g: (x: number) => number) => integrate((x) => phi(x) * g(x), -12, 0) + integrate((x) => phi(x) * g(x), 0, 12);

const ALL: Settings[] = ANGLES.flatMap((theta) => TARGETS.flatMap((target) => POINTS.map((points) => ({ target, theta, points }))));
const inWedge = (a: number, [from, to]: [number, number]) => {
  const d = (((a - from) % 360) + 360) % 360;
  return d > 1e-9 && d < to - from - 1e-9;
};

describe('Quadrant maths', () => {
  it('the normal distribution function is accurate to 1e-15 (reference values from mpmath)', () => {
    const ref: [number, number][] = [
      [-12, 1.7764821120776789977e-33],
      [-10, 7.619853024160526066e-24],
      [-8, 6.2209605742717841235e-16],
      [-5, 2.8665157187919391167e-7],
      [-3, 0.0013498980316300945267],
      [-2.999, 0.0013543365337271061616],
      [-2, 0.0227501319481792072],
      [-1, 0.15865525393145705141],
      [-0.5, 0.30853753872598689636],
      [0, 0.5],
      [0.3, 0.61791142218895263307],
      [1, 0.84134474606854294859],
      [2.5, 0.99379033467422386483],
      [3.001, 0.99865452717491503352],
      [4, 0.99996832875816688008],
      [6, 0.99999999901341235496],
    ];
    for (const [z, p] of ref) {
      expect(Math.abs(Phi(z) - p)).toBeLessThan(1e-15);
      if (z < -3) expect(Math.abs(Phi(z) / p - 1)).toBeLessThan(1e-12);
    }
    for (let i = 0; i < 200; i++) {
      const z = -9 + 18 * rng.next();
      expect(Math.abs(Phi(z) + Phi(-z) - 1)).toBeLessThan(2e-16);
    }
    // The CDF integrates the density.
    expect(Math.abs(integrate(phi, -12, 0.7) - Phi(0.7))).toBeLessThan(1e-14);
  });

  it("Sheppard: P(top-right) = ¼ + arcsin(ρ)/2π = (180° − θ)/360°, and same sign is twice that", () => {
    for (const theta of ANGLES) {
      for (const target of TARGETS) {
        expect(pPoint(target, theta)).toBeCloseTo(sheppard(target, rhoOf(theta)), 14);
        expect(greenSlices(target, theta)).toBe(((target === 'corner' ? 1 : 2) * (180 - theta)) / SLICE_DEG);
      }
      const q = quadrantChances(theta);
      expect(q.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 15);
      expect(q[0]).toBe(pPoint('corner', theta));
    }
    expect(rhoOf(90)).toBe(0);
    expect(cosDeg(270)).toBe(0);
    expect(sinDeg(180)).toBe(0);
  });

  it('the closed form matches a direct simulation of the correlated cloud (4 SE)', () => {
    for (const theta of ANGLES) {
      const rho = rhoOf(theta);
      const n = 30_000;
      let corner = 0;
      let same = 0;
      for (let i = 0; i < n; i++) {
        const x = normal(rng);
        const y = rho * x + Math.sqrt(1 - rho * rho) * normal(rng);
        if (inTarget('corner', x, y)) corner++;
        if (inTarget('same', x, y)) same++;
      }
      for (const [target, hits] of [['corner', corner], ['same', same]] as const) {
        const p = pPoint(target, theta);
        expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      }
    }
  });

  it('the game draws x and y with the right joint law (variances, correlation)', () => {
    for (const theta of [20, 90, 150]) {
      const n = 60_000;
      let sx = 0;
      let sy = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        const x = drawX(rng);
        const y = drawY(x, theta, rng);
        sx += x * x;
        sy += y * y;
        sxy += x * y;
      }
      expect(Math.abs(sx / n - 1)).toBeLessThan(0.03);
      expect(Math.abs(sy / n - 1)).toBeLessThan(0.03);
      expect(Math.abs(sxy / n - rhoOf(theta))).toBeLessThan(0.03);
    }
  });

  it('after x, P(lands | x) = Φ(ρx/√(1 − ρ²)) matches a simulation of y (4 SE)', () => {
    for (const theta of [10, 40, 90, 130, 170]) {
      for (const x of [-1.3, -0.2, 0.15, 0.6, 1.8]) {
        for (const target of TARGETS) {
          const n = 20_000;
          let hits = 0;
          for (let i = 0; i < n; i++) if (inTarget(target, x, drawY(x, theta, rng))) hits++;
          const p = pLandGivenX(target, theta, x);
          const rho = rhoOf(theta);
          if (target === 'corner' && x > 0) expect(p).toBeCloseTo(Phi((rho * x) / Math.sqrt(1 - rho * rho)), 13);
          expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-12);
        }
      }
    }
  });

  it('revealing x is a fair bet: E[cash-out after x] = cash-out before (to 1e-9)', () => {
    for (const s of ALL) {
      expect(cashOut(s, { landed: 0, x: null })).toBeCloseTo(RTP, 12);
      for (let landed = 0; landed < s.points; landed++) {
        const before = cashOut(s, { landed, x: null });
        const after = normalMean((x) => cashOut(s, { landed, x }));
        expect(Math.abs(after - before) / before).toBeLessThan(1e-9);
      }
      // The tower property in its plainest form.
      expect(Math.abs(normalMean((x) => pLandGivenX(s.target, s.theta, x)) - pPoint(s.target, s.theta))).toBeLessThan(1e-12);
    }
  });

  it('revealing y is a fair bet: E[cash-out after y | x] = cash-out at x (to 1e-9)', () => {
    for (const s of ALL) {
      for (let trial = 0; trial < 4; trial++) {
        const landed = rng.int(s.points);
        const x = normal(rng);
        const now = cashOut(s, { landed, x });
        const ifIn = landed + 1 === s.points ? prize(s) : cashOut(s, { landed: landed + 1, x: null });
        const { mean, sd } = condY(x, s.theta);
        // ∫ density(y | x) × pay-off(y) dy, split at y = 0.
        const pay = (y: number) => (inTarget(s.target, x, y) ? ifIn : 0);
        const dens = (y: number) => phi((y - mean) / sd) / sd;
        const lo = mean - 14 * sd;
        const hi = mean + 14 * sd;
        const after =
          integrate((y) => dens(y) * pay(y), lo, Math.min(0, hi)) + integrate((y) => dens(y) * pay(y), Math.max(0, lo), hi);
        expect(Math.abs(after - now)).toBeLessThan(1e-9 * Math.max(1, now));
      }
    }
  });

  it('the green share of the drawn cloud is exactly the chance, and every slice holds the same area', () => {
    for (const theta of ANGLES) {
      for (const R of [1, 2.6]) {
        const whole = polygonArea(fan(0, 360, theta, R));
        for (const target of TARGETS) {
          const green = targetWedges(target, theta).reduce((a, [from, to]) => a + polygonArea(fan(from, to, theta, R)), 0);
          const red = missWedges(target, theta).reduce((a, [from, to]) => a + polygonArea(fan(from, to, theta, R)), 0);
          expect(Math.abs(green / whole - pPoint(target, theta))).toBeLessThan(1e-12);
          expect(Math.abs((green + red) / whole - 1)).toBeLessThan(1e-12);
        }
        const slice = whole / SLICES;
        for (let k = 0; k < SLICES; k++) expect(Math.abs(polygonArea(fan(k * SLICE_DEG, (k + 1) * SLICE_DEG, theta, R)) / slice - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('a point is in the target exactly when it lies in a green slice, and the axes sit on slice edges', () => {
    for (const theta of ANGLES) {
      // The axes are the images of round-frame angles 90°, 270° (x = 0) and θ ± 90° (y = 0).
      for (const a of [90, 270]) expect(Math.abs(cloudPoint(a, theta, 1)[0])).toBe(0);
      for (const a of [theta - 90, theta + 90]) expect(Math.abs(cloudPoint(a, theta, 1)[1])).toBeLessThan(1e-15);
      for (const a of [90, 270, theta - 90, theta + 90]) expect(((a % SLICE_DEG) + SLICE_DEG) % SLICE_DEG).toBe(0);
      for (let i = 0; i < 400; i++) {
        const x = 3 * (2 * rng.next() - 1);
        const y = 3 * (2 * rng.next() - 1);
        const a = roundAngle(x, y, theta);
        for (const target of TARGETS) {
          const green = targetWedges(target, theta).some((w) => inWedge(a, w));
          expect(green).toBe(inTarget(target, x, y));
        }
      }
    }
  });

  it('the green share of the bell drawn on the x slice is the true chance', () => {
    for (const theta of ANGLES) {
      for (let i = 0; i < 25; i++) {
        const x = 2.5 * (2 * rng.next() - 1);
        for (const target of TARGETS) {
          const p = pLandGivenX(target, theta, x);
          expect(Math.abs(bellShare(target, x, bell(x, theta)) - p)).toBeLessThan(5e-4);
          expect(Math.abs(bellShare(target, x, bell(x, theta, 4000)) - p)).toBeLessThan(2e-5);
        }
      }
    }
  });

  it('a reveal that settles a point is detected; otherwise a checkpoint is offered', () => {
    expect(pLandGivenX('corner', 60, -0.4)).toBe(0);
    expect(pLandGivenX('corner', 60, 0)).toBe(0);
    expect(settles(pLandGivenX('corner', 60, -0.4))).toBe(true);
    expect(settles(pLandGivenX('same', 10, 3))).toBe(true); // Φ(17) rounds to 1
    expect(settles(pLandGivenX('same', 90, 3))).toBe(false); // ρ = 0: y is a coin flip
    expect(pLandGivenX('same', 90, 1.7)).toBe(0.5);
    expect(pWin({ target: 'corner', theta: 90, points: 2 }, { landed: 1, x: null })).toBeCloseTo(0.25, 15);
  });

  it('prizes, the volatility range and the max multiplier are honest', () => {
    for (const s of ALL) {
      expect(prize(s)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      expect(pWin0(s)).toBeGreaterThan(0);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 36 ** 3, 6);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    const ps = ALL.filter((s) => s.points === 1).map(pWin0);
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
