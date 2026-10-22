import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  HOMES,
  RTP,
  STEPS,
  contours,
  dist,
  homeChance,
  integrate,
  oneStepChance,
  prepare,
  prizeFor,
  singularRadii,
  stepArcs,
  stepFrom,
  upShare,
  verdict,
  winChance,
  type Pt,
} from './math';

const rng = createRng(seededSource(11));
const KMAX = Math.max(...STEPS);
for (const rho of HOMES) prepare(rho, KMAX);

/** The cash-out (per unit of prize) after landing at distance d with k steps left. */
const valueAt = (k: number, d: number, rho: number) => {
  const v = verdict(k, d, rho);
  return v === 'home' ? 1 : v === 'lost' ? 0 : homeChance(k, d, rho);
};

/** E[value after one more step] from distance r with k steps left, by exact quadrature over the direction. */
function nextValue(k: number, r: number, rho: number): number {
  const lo = Math.abs(r - 1);
  const hi = r + 1;
  const cuts = [0, Math.PI];
  for (const b of singularRadii(k - 1, rho)) {
    if (b > lo && b < hi) cuts.push(Math.acos(Math.min(1, Math.max(-1, (b * b - r * r - 1) / (2 * r)))));
  }
  cuts.sort((a, b) => a - b);
  const g = (t: number) => valueAt(k - 1, Math.sqrt(Math.max(0, r * r + 1 + 2 * r * Math.cos(t))), rho);
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    for (let j = 0; j < 4; j++) s += integrate(g, cuts[i] + ((cuts[i + 1] - cuts[i]) * j) / 4, cuts[i] + ((cuts[i + 1] - cuts[i]) * (j + 1)) / 4);
  }
  return s / Math.PI;
}

describe('Pearson Walk maths', () => {
  it('Kluyver: a walk of n unit steps ends within one step of its start with chance exactly 1/(n+1)', () => {
    for (let n = 2; n <= KMAX; n++) {
      expect(Math.abs(homeChance(n, 0, 1) - 1 / (n + 1))).toBeLessThan(1e-9);
      expect(Math.abs(homeChance(n - 1, 1, 1) - 1 / (n + 1))).toBeLessThan(1e-9);
    }
    for (const n of STEPS) expect(winChance(n, 1)).toBe(1 / (n + 1));
  });

  it('the headline chances match the live tables and the closed forms', () => {
    for (const rho of HOMES) {
      for (const n of STEPS) {
        const p = winChance(n, rho);
        expect(Math.abs(homeChance(n - 1, 1, rho) - p)).toBeLessThan(1e-9);
        expect(Math.abs(homeChance(n, 0, rho) - p)).toBeLessThan(1e-9);
      }
      // Two steps: |S₂| = 2|cos(θ/2)|, so P(|S₂| ≤ ρ) = (2/π)·asin(ρ/2).
      expect(Math.abs(winChance(2, rho) - (2 / Math.PI) * Math.asin(rho / 2))).toBeLessThan(1e-15);
    }
  });

  it('the tables satisfy exact integral identities: ∫P dA = πρ² and ∫|x|²P dA = πρ²(ρ²/2 + k)', () => {
    for (const rho of HOMES) {
      for (let k = 1; k <= KMAX; k++) {
        const br = singularRadii(k, rho);
        let m0 = 0;
        let m2 = 0;
        for (let i = 0; i + 1 < br.length; i++) {
          for (let j = 0; j < 4; j++) {
            const a = br[i] + ((br[i + 1] - br[i]) * j) / 4;
            const b = br[i] + ((br[i + 1] - br[i]) * (j + 1)) / 4;
            m0 += integrate((r) => 2 * r * homeChance(k, r, rho), a, b);
            m2 += integrate((r) => 2 * r ** 3 * homeChance(k, r, rho), a, b);
          }
        }
        expect(Math.abs(m0 - rho * rho)).toBeLessThan(1e-7);
        expect(Math.abs(m2 - (rho ** 4 / 2 + rho * rho * k))).toBeLessThan(1e-6);
      }
    }
  });

  it('home one step wide: (k+1)·P_k(r) = P(|S_{k+1}| > r), i.e. 1 − P_k(1) with home radius r', () => {
    for (const rho of HOMES) {
      if (rho === 1) continue;
      for (let k = 1; k < KMAX; k++) expect(Math.abs((k + 1) * homeChance(k, rho, 1) - (1 - homeChance(k, 1, rho)))).toBeLessThan(1e-8);
    }
  });

  it('the one-step formula is the share of directions that land home', () => {
    for (const rho of HOMES) {
      for (let i = 0; i < 40; i++) {
        const r = 0.05 + 2.6 * rng.next();
        const N = 7200;
        let inside = 0;
        for (let j = 0; j < N; j++) if (dist(stepFrom({ x: r, y: 0 }, (2 * Math.PI * (j + 0.5)) / N)) <= rho) inside++;
        expect(Math.abs(inside / N - oneStepChance(r, rho))).toBeLessThan(2 / N);
      }
    }
  });

  it('simulated raw walks end home as often as the formula says', () => {
    for (const rho of HOMES) {
      for (const n of STEPS) {
        const rounds = 20_000;
        let wins = 0;
        for (let i = 0; i < rounds; i++) {
          let x = 0;
          let y = 0;
          for (let s = 0; s < n; s++) {
            const a = rng.next() * 2 * Math.PI;
            x += Math.cos(a);
            y += Math.sin(a);
          }
          if (Math.hypot(x, y) <= rho) wins++;
        }
        const p = winChance(n, rho);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('each step is a fair bet: E[cash-out after the step] = cash-out now, at random reachable states', () => {
    let worst = 0;
    for (const rho of HOMES) {
      for (const n of STEPS) {
        const prize = prizeFor(n, rho);
        for (let trial = 0; trial < 12; trial++) {
          // Walk a random number of steps, staying in live states.
          let p: Pt = stepFrom({ x: 0, y: 0 }, rng.next() * 2 * Math.PI);
          let left = n - 1;
          const stop = 1 + rng.int(n - 1);
          while (n - left < stop) {
            const q = stepFrom(p, rng.next() * 2 * Math.PI);
            if (verdict(left - 1, dist(q), rho)) continue;
            p = q;
            left--;
          }
          const now = prize * homeChance(left, dist(p), rho);
          const next = prize * nextValue(left, dist(p), rho);
          worst = Math.max(worst, Math.abs(next - now));
        }
      }
    }
    expect(worst).toBeLessThan(1e-7);
  });

  it('the first step is free: the cash-out after it is exactly the RTP', () => {
    for (const rho of HOMES) for (const n of STEPS) expect(Math.abs(prizeFor(n, rho) * homeChance(n - 1, 1, rho) - RTP)).toBeLessThan(1e-8);
  });

  it('the drawn odds are the true odds: the last step’s green arc, the rising arcs and the labelled rings', () => {
    for (const rho of HOMES) {
      for (let trial = 0; trial < 30; trial++) {
        const k = 1 + rng.int(6);
        const a = rng.next() * 2 * Math.PI;
        const r = 0.05 + (k + rho - 0.1) * rng.next();
        const p = { x: r * Math.cos(a), y: r * Math.sin(a) };
        if (verdict(k, r, rho)) continue;
        const arcs = stepArcs(k, p, rho)!;
        const now = homeChance(k, r, rho);
        if (k === 1) expect(Math.abs(upShare(arcs) - now)).toBeLessThan(1e-12);
        // Sweep the step circle: a direction is drawn green exactly when landing there raises the odds.
        const N = 720;
        for (let j = 0; j < N; j++) {
          const t = a + (2 * Math.PI * (j + 0.5)) / N;
          const arc = arcs.find((s) => {
            const u = (((t - s.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            return u < s.to - s.from;
          })!;
          const edge = Math.min(...arcs.map((s) => Math.min(Math.abs(Math.sin((t - s.from) / 2)), Math.abs(Math.sin((t - s.to) / 2)))));
          if (edge < 2e-3) continue;
          expect(arc.up).toBe(valueAt(k - 1, dist(stepFrom(p, t)), rho) > now);
        }
      }
      for (let k = 1; k <= KMAX; k++) {
        for (const c of contours(k, rho, Math.min(k + rho, 7))) expect(Math.abs(homeChance(k, c.radius, rho) - c.level)).toBeLessThan(1e-9);
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
