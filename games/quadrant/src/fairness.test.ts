// Fairness audit: can any way of playing Quadrant beat the RTP?
//
// A round as Game.tsx plays it: the bet draws the first point's x (no
// checkpoint before it), then each point is two reveals. Once x is known the
// player may cash out at prize × P(lands | x) × p^(left) or reveal y; after a
// point lands (with more to go) the player may cash out at prize × p^(left) or
// draw the next x. An x that settles its point (chance exactly 0 or 1) skips
// the checkpoint. Target, ρ and points are locked while live; every reveal is
// drawn when its button is pressed (y never exists before Reveal y), all
// buttons are hidden while revealing, Space and C call the same next() /
// cashOutNow(), and the ticket reads only the `fair` ref, which is set to the
// post-reveal value before each reveal animates.
//
// Martingale check:
//   - x reveal, exact (quadrature, 1e-9): E_x[P(lands | x)] = p for all 34
//     (target, θ) pairs, so E[V after x] = V at every between-points state;
//   - y reveal, exact algebra: P(lands | x) × V(after landing) = V(x), at 40+
//     x-checkpoints reached through the real drawX();
//   - sampled: 100k real drawY() at a spread of x-checkpoints land at
//     P(lands | x) within 4 SE, and 100k real drawX() give E[V after x] = V.
// Strategies, per eval config:
//   (a) take the next reveal only if it survives with chance ≥ 80% (x of a
//       top-right point survives 50%, so (a) cashes between points there);
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) reveal everything;
//   (d) cherry-pick: reveal y only when x improved the odds (P(lands | x) ≥ p),
//       cash out when x was bad.
// Each strategy's RTP is computed exactly by integrating over x (the
// strategies depend only on the state), and simulated through the game's
// draws. The extreme config pays up to 722×, so its Monte Carlo SE is large;
// the exact integral is the binding check there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ANGLES,
  POINTS,
  RTP,
  TARGETS,
  cashOut,
  drawX,
  drawY,
  inTarget,
  pLandGivenX,
  pPoint,
  phi,
  prize,
  settles,
  type Settings,
  type State,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;

/** At a checkpoint: stop (cash out) or go on. `next` is the chance the next reveal does not lose the round. */
type Stop = (s: Settings, st: State, cash: number, next: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) reveal only at ≥ 80% survival', stop: (_, __, ___, next) => next < 0.8 },
  { name: '(b) take any profit', stop: (_, __, cash) => cash > 1 },
  { name: '(c) reveal everything', stop: () => false },
  { name: '(d) reveal y only when x helped', stop: (s, st) => st.x !== null && pLandGivenX(s.target, s.theta, st.x) < pPoint(s.target, s.theta) },
];

/** Survival chance of the next reveal: an x survives unless it settles the point as lost; a y survives with P(lands | x). */
const nextSurvival = (s: Settings, st: State) => (st.x === null ? (s.target === 'corner' ? 0.5 : 1) : pLandGivenX(s.target, s.theta, st.x));

/** One round as Game.tsx plays it. */
function playRound(s: Settings, stop: Stop, rng: Rng): number {
  let landed = 0;
  for (;;) {
    // Draw x (with the bet for the first point, by Next point after that).
    const x = drawX(rng);
    const p = pLandGivenX(s.target, s.theta, x);
    if (!settles(p)) {
      const st = { landed, x };
      const cash = cashOut(s, st);
      if (stop(s, st, cash, nextSurvival(s, st))) return cash;
    }
    const y = drawY(x, s.theta, rng);
    if (!inTarget(s.target, x, y)) return 0;
    landed++;
    if (landed === s.points) return prize(s);
    const st = { landed, x: null };
    const cash = cashOut(s, st);
    if (stop(s, st, cash, nextSurvival(s, st))) return cash;
  }
}

// 10-point Gauss–Legendre nodes and weights on [−1, 1] (symmetric halves).
const GL_X = [0.1488743389816312, 0.4333953941292472, 0.6794095682990244, 0.8650633666889845, 0.9739065285171717];
const GL_W = [0.2955242247147529, 0.2692667193099963, 0.2190863625159820, 0.1494513491505806, 0.0666713443086881];

/** Composite 10-point Gauss–Legendre of f over [a, b] with n panels (never evaluates the endpoints). */
function gauss(f: (x: number) => number, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const c = a + (i + 0.5) * h;
    for (let j = 0; j < 5; j++) s += GL_W[j] * (f(c - (h / 2) * GL_X[j]) + f(c + (h / 2) * GL_X[j]));
  }
  return (s * h) / 2;
}

/**
 * E over x ~ N(0, 1) of g(x), split at 0 where P(lands | x) jumps (top-right).
 * Gauss nodes never touch 0, so the tie rule (x = 0 misses, probability zero)
 * does not enter. The integrands are smooth on each side (for a fair game the
 * value under any stopping rule equals V, so the rules add no kinks), and
 * [−9, 9] holds all but 2e-19 of the mass.
 */
const expectX = (g: (x: number) => number, n = 48) => gauss((x) => phi(x) * g(x), -9, 0, n) + gauss((x) => phi(x) * g(x), 0, 9, n);

/** Exact RTP of a state-dependent stopping rule, by integrating over every x. */
function exactRtp(s: Settings, stop: Stop): number {
  const memo = new Map<number, number>();
  // Value of drawing x with `landed` points in.
  const F = (landed: number): number => {
    let v = memo.get(landed);
    if (v === undefined) {
      v = expectX((x) => G(landed, x));
      memo.set(landed, v);
    }
    return v;
  };
  const G = (landed: number, x: number): number => {
    const p = pLandGivenX(s.target, s.theta, x);
    if (settles(p)) return p === 1 ? H(landed + 1) : 0;
    const st = { landed, x };
    const cash = cashOut(s, st);
    return stop(s, st, cash, nextSurvival(s, st)) ? cash : p * H(landed + 1);
  };
  const H = (landed: number): number => {
    if (landed === s.points) return prize(s);
    const st = { landed, x: null };
    const cash = cashOut(s, st);
    return stop(s, st, cash, nextSurvival(s, st)) ? cash : F(landed);
  };
  return F(0);
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

const ALL: Settings[] = TARGETS.flatMap((target) => ANGLES.flatMap((theta) => POINTS.map((points) => ({ target, theta, points }))));

/** x-checkpoints (x known, not settled) met while playing random rounds to the end. */
function xCheckpoints(count: number, rng: Rng): { s: Settings; st: { landed: number; x: number } }[] {
  const out: { s: Settings; st: { landed: number; x: number } }[] = [];
  while (out.length < count) {
    const s = ALL[rng.int(ALL.length)];
    for (let landed = 0; landed < s.points; landed++) {
      const x = drawX(rng);
      if (!settles(pLandGivenX(s.target, s.theta, x))) out.push({ s, st: { landed, x } });
      if (!inTarget(s.target, x, drawY(x, s.theta, rng))) break;
    }
  }
  return out.slice(0, count);
}

describe('Quadrant fairness', () => {
  it('martingale (exact): revealing x is worth V at every between-points state of all 102 settings', () => {
    let states = 0;
    for (const target of TARGETS) {
      for (const theta of ANGLES) {
        const p = pPoint(target, theta);
        const ex = expectX((x) => pLandGivenX(target, theta, x));
        expect(Math.abs(ex - p)).toBeLessThan(1e-9);
        for (const points of POINTS) {
          const s = { target, theta, points };
          for (let landed = 0; landed < points; landed++) {
            states++;
            const before = cashOut(s, { landed, x: null });
            const after = expectX((x) => cashOut(s, { landed, x }));
            expect(Math.abs(after - before)).toBeLessThan(1e-9 * Math.max(1, before));
          }
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('martingale (exact): revealing y is worth V at 40+ x-checkpoints reached through drawX', () => {
    const rng = createRng(seededSource(808));
    const cps = xCheckpoints(48, rng);
    expect(cps.filter(({ s, st }) => st.landed === s.points - 1).length).toBeGreaterThanOrEqual(10);
    for (const { s, st } of cps) {
      const v = cashOut(s, st);
      const pl = pLandGivenX(s.target, s.theta, st.x);
      const hitValue = st.landed + 1 === s.points ? prize(s) : cashOut(s, { landed: st.landed + 1, x: null });
      expect(Math.abs(pl * hitValue - v)).toBeLessThan(1e-12 * Math.max(1, v));
      expect(v).toBeLessThanOrEqual(prize(s) * (1 + 1e-12));
    }
  });

  it('martingale (sampled): 100k real draws match P(lands | x) and E[V after x] within 4 SE', () => {
    const rng = createRng(seededSource(909));
    for (const { s, st } of xCheckpoints(6, rng)) {
      const pl = pLandGivenX(s.target, s.theta, st.x);
      let hits = 0;
      for (let i = 0; i < SAMPLES; i++) if (inTarget(s.target, st.x, drawY(st.x, s.theta, rng))) hits++;
      expect(Math.abs(hits / SAMPLES - pl)).toBeLessThan(4 * Math.sqrt((pl * (1 - pl)) / SAMPLES) + 1e-9);
    }
    for (const s of [evalSpec.configs[1].params, evalSpec.configs[3].params, { target: 'corner', theta: 170, points: 1 } as Settings]) {
      const before = cashOut(s, { landed: 0, x: null });
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const v = cashOut(s, { landed: 0, x: drawX(rng) });
        sum += v;
        sum2 += v * v;
      }
      const mean = sum / SAMPLES;
      const se = Math.sqrt((sum2 / SAMPLES - mean * mean) / SAMPLES);
      expect(Math.abs(mean - before)).toBeLessThan(4 * se);
    }
  });

  it('strategies (a)–(d) are exactly RTP on all 102 settings (integrated over x)', () => {
    for (const s of ALL) for (const { stop } of STRATEGIES) expect(Math.abs(exactRtp(s, stop) - RTP)).toBeLessThan(1e-6);
  });

  it('strategies (a)–(d) through the game’s draws on every eval config: RTP within 4 SE, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(params, stop, r), ROUNDS, 4100 + 13 * ci + si);
        const exact = exactRtp(params, stop);
        rows.push(`${label.padEnd(44)} ${name.padEnd(36)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exact * 100).toFixed(4)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(prize(params) + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
