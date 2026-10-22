import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ARC_MAX,
  ARC_MIN,
  CENTRE,
  HOP,
  LEVELS,
  RINGS,
  TAU,
  angleOf,
  arcEnds,
  cashOut,
  fromCentre,
  geodesic,
  haloArc,
  hitDensity,
  inArc,
  leg,
  levelCurve,
  norm,
  polar,
  prize,
  release,
  ringHit,
  ringRadii,
  winChance,
  winChanceByAngle,
  type Pt,
} from './math';

const rng = createRng(seededSource(11));
const ARCS = [5, 10, 30, 60, 90, 135, 180, 270];

/** A random point in the disc of radius r (uniform in area). */
function randomPoint(r: number): Pt {
  return polar(TAU * rng.next(), r * Math.sqrt(rng.next()));
}

/** Trapezoid rule over a full period (exponentially accurate for smooth periodic integrands). */
function circleMean(f: (t: number) => number, n = 8192) {
  let s = 0;
  for (let i = 0; i < n; i++) s += f((TAU * i) / n);
  return s / n;
}

/** The raw process: plain walk on spheres (no exact final sample) until within 1e-7 of the rim. */
function rawExitAngle(z: Pt): number {
  let p = z;
  for (;;) {
    const d = 1 - norm(p);
    if (d < 1e-7) return angleOf(p);
    const t = TAU * rng.next();
    p = { x: p.x + 0.9 * d * Math.cos(t), y: p.y + 0.9 * d * Math.sin(t) };
  }
}

const within4se = (hits: number, n: number, p: number) =>
  expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-4);

describe('Halo maths', () => {
  it('the Möbius formula agrees with the inscribed-angle formula and the Poisson integral', () => {
    for (const arc of ARCS) {
      expect(winChance(CENTRE, arc)).toBeCloseTo(arc / 360, 12);
      const { a } = arcEnds(arc);
      const len = (arc * Math.PI) / 180;
      for (let i = 0; i < 25; i++) {
        const z = randomPoint(0.92);
        const w = winChance(z, arc);
        expect(winChanceByAngle(z, arc)).toBeCloseTo(w, 10);
        // ω(z) = (1/2π) ∫_G P(z, t) dt, by the midpoint rule on G.
        const n = 20000;
        let s = 0;
        for (let j = 0; j < n; j++) s += hitDensity(z, 1, a + (len * (j + 0.5)) / n);
        expect(Math.abs((s * len) / n / TAU - w)).toBeLessThan(1e-6);
      }
    }
  });

  it('raw Brownian motion leaves through G as often as ω(z) says', () => {
    const starts: Pt[] = [CENTRE, { x: 0, y: 0.6 }, { x: 0.5, y: -0.3 }, { x: -0.75, y: 0.4 }];
    for (const arc of [5, 45, 120, 270]) {
      for (const z of starts) {
        const n = 6000;
        let hits = 0;
        for (let r = 0; r < n; r++) if (inArc(rawExitAngle(z), arc)) hits++;
        within4se(hits, n, winChance(z, arc));
      }
    }
  });

  it('the game process (walk to each ring, then release) wins with chance |G| / 360°', () => {
    for (const arc of [10, 90, 270]) {
      for (const rings of RINGS) {
        const radii = ringRadii(rings);
        const n = 6000;
        let wins = 0;
        for (let r = 0; r < n; r++) {
          let z = CENTRE;
          for (const rho of radii) {
            const path = leg(z, rho, rng.next);
            z = path[path.length - 1];
          }
          if (release(z, arc, rng.next()).win) wins++;
        }
        within4se(wins, n, arc / 360);
      }
    }
  });

  it('a leg ends on its ring with Brownian law: E[hit] = z and E[ω(hit)] = ω(z)', () => {
    for (const rings of [2, 6] as const) {
      const radii = ringRadii(rings);
      for (let k = 1; k < radii.length; k++) {
        const z = polar(TAU * rng.next(), radii[k - 1]);
        const rho = radii[k];
        const n = 8000;
        let sx = 0;
        let sy = 0;
        let sw = 0;
        let sw2 = 0;
        let offRing = 0;
        let outside = 0;
        for (let r = 0; r < n; r++) {
          const path = leg(z, rho, rng.next);
          const end = path[path.length - 1];
          offRing = Math.max(offRing, Math.abs(norm(end) - rho));
          for (const p of path) outside = Math.max(outside, norm(p) - rho);
          sx += end.x;
          sy += end.y;
          const w = winChance(end, 60);
          sw += w;
          sw2 += w * w;
        }
        expect(offRing).toBeLessThan(1e-12);
        expect(outside).toBeLessThan(1e-12);
        const se = (v: number) => 4 * Math.sqrt(v / n) + 1e-4;
        expect(Math.abs(sx / n - z.x)).toBeLessThan(se(rho * rho));
        expect(Math.abs(sy / n - z.y)).toBeLessThan(se(rho * rho));
        const mean = sw / n;
        expect(Math.abs(mean - winChance(z, 60))).toBeLessThan(se(sw2 / n - mean * mean));
      }
    }
  });

  it('every step is a fair bet: E[cash-out after] = cash-out now', () => {
    for (const arc of ARCS) {
      for (const rings of [2, 4, 6]) {
        const radii = ringRadii(rings);
        let z = CENTRE;
        for (let k = 0; k < radii.length; k++) {
          const now = cashOut(z, arc);
          // A whole leg: the hit point on the ring has the Poisson kernel density.
          const rho = radii[k];
          expect(circleMean((t) => cashOut(polar(t, rho), arc) * hitDensity(z, rho, t))).toBeCloseTo(now, 9);
          // A single hop of the walk: a uniform point on a circle around z.
          const r = HOP * (rho - norm(z));
          expect(circleMean((t) => cashOut({ x: z.x + r * Math.cos(t), y: z.y + r * Math.sin(t) }, arc))).toBeCloseTo(now, 9);
          z = ringHit(z, rho, rng.next());
        }
        // The release pays the prize with chance ω.
        expect(prize(arc) * winChance(z, arc)).toBeCloseTo(cashOut(z, arc), 12);
      }
    }
    expect(cashOut(CENTRE, ARC_MIN)).toBeCloseTo(0.99, 12);
    expect(cashOut(CENTRE, ARC_MAX)).toBeCloseTo(0.99, 12);
  });

  it('the green part of the halo is exactly the set of release directions that exit through G', () => {
    for (const arc of ARCS) {
      for (let i = 0; i < 12; i++) {
        const z = randomPoint(0.9);
        const w = winChance(z, arc);
        const halo = haloArc(z, arc);
        expect(halo.length / TAU).toBeCloseTo(w, 15);
        const N = 2000;
        let green = 0;
        let mismatches = 0;
        let offRim = 0;
        for (let j = 0; j < N; j++) {
          const u = (j + 0.5) / N;
          const r = release(z, arc, u);
          if (r.win) green++;
          // Away from the two boundary directions the exit point agrees with the halo colour.
          if (Math.min(Math.abs(u - w), u, 1 - u) > 2 / N && inArc(angleOf(r.exit), arc) !== r.win) mismatches++;
          offRim = Math.max(offRim, Math.abs(norm(r.exit) - 1));
        }
        expect(mismatches).toBe(0);
        expect(offRim).toBeLessThan(1e-9);
        expect(Math.abs(green / N - w)).toBeLessThanOrEqual(1 / N + 1e-12);
      }
    }
  });

  it('the release geodesic leaves z in the halo direction and ends at the exit point', () => {
    for (let i = 0; i < 40; i++) {
      const z = randomPoint(0.9);
      const theta = TAU * rng.next();
      const g = geodesic(z, theta);
      expect(g[0].x).toBeCloseTo(z.x, 12);
      expect(g[0].y).toBeCloseTo(z.y, 12);
      const r = release(z, 90, (theta - haloArc(z, 90).start) / TAU);
      const end = g[g.length - 1];
      expect(Math.hypot(end.x - r.exit.x, end.y - r.exit.y)).toBeLessThan(1e-9);
      // (φ_z⁻¹)'(0) = 1 − |z|² > 0, so the geodesic's initial direction is θ itself.
      const step = fromCentre(z, polar(theta, 1e-7));
      expect(Math.abs(Math.sin(angleOf({ x: step.x - z.x, y: step.y - z.y }) - theta))).toBeLessThan(1e-5);
      expect(Math.max(...g.map(norm))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('the drawn iso-odds arcs are exactly the level sets of ω', () => {
    for (const arc of [...ARCS, 45, 270]) {
      for (const c of LEVELS) {
        const pts = levelCurve(arc, c, 48);
        const inner = pts.slice(2, -2);
        expect(Math.max(...inner.map(norm))).toBeLessThan(1);
        expect(Math.max(...inner.map((p) => Math.abs(winChance(p, arc) - c)))).toBeLessThan(1e-9);
      }
    }
  });

  it('simulated RTP matches the manifest under every sampled strategy', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
