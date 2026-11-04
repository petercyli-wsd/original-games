// Fairness audit: can any way of playing Pearson Walk beat the RTP?
//
// A round as Game.tsx plays it: the bet takes the first step (no free step:
// every step is a uniform direction from rng.next()). After each step the
// round ends at once if it is decided (verdict 'home' pays the prize, 'lost'
// pays 0), else it waits at a checkpoint worth prize × P_k(r). The only
// choice is Cash out, Next step or Run to the end (= Next step until decided);
// steps and home are locked while live, every button is disabled while a step
// animates, and Space and C call the same walk() / cashOut().
//
// Pricing is a tabulated integral, so the martingale holds to numerical
// precision, not exactly. The check measures how far it is off:
//   - at 60+ reached checkpoints (all homes and step counts, the last step
//     included) and at points a hair either side of every singular radius,
//     E[V after the step] by independent, finer quadrature over the step
//     direction equals V to 1e-7× of the stake (a dense scan in the audit
//     notes found the worst bias 9e-8× per step, ~1e-6× per round);
//   - sampled: 100k real steps at a spread of states match V within 4 SE.
// Strategies, per eval config, through the game's functions:
//   (a) step only while the next step survives (is not decided lost) with
//       chance ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) walk to the end;
//   (d) farm the table error: cash out whenever the walker is within 0.02 of
//       a singular radius of P_k (where interpolation is least accurate);
//   (e) momentum: cash out after a step that moved away from the centre.
// The walker has no direction to choose, so (d) and (e) are stopping rules.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  HOMES,
  RTP,
  START,
  STEPS,
  dist,
  homeChance,
  integrate,
  oneStepChance,
  prepare,
  prizeFor,
  singularRadii,
  stepFrom,
  verdict,
  type Home,
  type Steps,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;
const KMAX = Math.max(...STEPS);
for (const rho of HOMES) prepare(rho, KMAX);

/** The cash-out per unit of prize at distance d with k steps left, as the game settles it. */
const valueAt = (k: number, d: number, rho: number) => {
  const v = verdict(k, d, rho);
  return v === 'home' ? 1 : v === 'lost' ? 0 : homeChance(k, d, rho);
};

/** E[value after one step] from distance r with k left: quadrature split at every singular radius, 8 sub-pieces each. */
function nextValue(k: number, r: number, rho: number): number {
  const cuts = [0, Math.PI];
  for (const b of singularRadii(k - 1, rho)) {
    if (b > Math.abs(r - 1) && b < r + 1) cuts.push(Math.acos(Math.min(1, Math.max(-1, (b * b - r * r - 1) / (2 * r)))));
  }
  cuts.sort((a, b) => a - b);
  const g = (t: number) => valueAt(k - 1, Math.sqrt(Math.max(0, r * r + 1 + 2 * r * Math.cos(t))), rho);
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const w = (cuts[i + 1] - cuts[i]) / 8;
    for (let j = 0; j < 8; j++) s += integrate(g, cuts[i] + w * j, cuts[i] + w * (j + 1));
  }
  return s / Math.PI;
}

/** Chance the next step from r (k left) does not end the round lost: the share of directions landing short of the red zone. */
function survival(k: number, r: number, rho: number): number {
  const left = k - 1;
  if (left === 0) return oneStepChance(r, rho);
  if (left === 1) return oneStepChance(r, 1 + rho) - (rho < 1 ? oneStepChance(r, 1 - rho) : 0);
  return oneStepChance(r, left + rho);
}

interface State {
  n: Steps;
  home: Home;
  k: number;
  r: number;
  prevR: number;
  cash: number;
}

type Stop = (s: State) => boolean;

const nearSingular = (s: State) => singularRadii(s.k, s.home).some((b) => Math.abs(s.r - b) < 0.02);

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) step while ≥ 80% survives', stop: (s) => survival(s.k, s.r, s.home) < 0.8 },
  { name: '(b) take any profit', stop: (s) => s.cash > 1 },
  { name: '(c) walk to the end', stop: () => false },
  { name: '(d) cash near a singular radius', stop: nearSingular },
  { name: '(e) cash after a step away', stop: (s) => s.r > s.prevR },
];

/** One round as Game.tsx plays it: the bet takes step 1, then checkpoint → stop or step, ending at once when decided. */
function playRound(n: Steps, home: Home, stop: Stop, rng: Rng): number {
  const prize = prizeFor(n, home);
  const s: State = { n, home, k: n, r: START, prevR: START, cash: RTP };
  for (;;) {
    const to = stepFrom({ x: 0, y: -s.r }, rng.next() * 2 * Math.PI);
    const d = dist(to);
    const end = verdict(s.k - 1, d, home);
    if (end) return end === 'home' ? prize : 0;
    s.prevR = s.r;
    s.r = d;
    s.k--;
    s.cash = prize * homeChance(s.k, d, home);
    if (stop(s)) return s.cash;
  }
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

/** Checkpoints met while playing random rounds to the end (kept at random, always the one before the last step). */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const home = HOMES[out.length % HOMES.length];
    const n = STEPS[rng.int(STEPS.length)];
    const s: State = { n, home, k: n, r: START, prevR: START, cash: RTP };
    for (;;) {
      const d = dist(stepFrom({ x: 0, y: -s.r }, rng.next() * 2 * Math.PI));
      if (verdict(s.k - 1, d, home)) break;
      s.prevR = s.r;
      s.r = d;
      s.k--;
      s.cash = prizeFor(n, home) * homeChance(s.k, d, home);
      if (rng.next() < 0.4 || s.k === 1) out.push({ ...s });
    }
  }
  return out.slice(0, count);
}

describe('Pearson Walk fairness', () => {
  it('the start is worth RTP on every setting: prize × P_N(1) = 0.99 (to 1e-8)', () => {
    for (const home of HOMES) for (const n of STEPS) expect(Math.abs(prizeFor(n, home) * homeChance(n, START, home) - RTP)).toBeLessThan(1e-8);
  });

  it('martingale: at 60+ reached checkpoints and both sides of every singular radius, E[V after a step] = V to 1e-7×', () => {
    const rng = createRng(seededSource(4242));
    const states = reachedStates(64, rng);
    expect(new Set(states.map((s) => s.k)).size).toBeGreaterThanOrEqual(6);
    expect(states.filter((s) => s.k === 1).length).toBeGreaterThanOrEqual(8);
    let worst = 0;
    for (const s of states) {
      const prize = prizeFor(s.n, s.home);
      worst = Math.max(worst, prize * Math.abs(nextValue(s.k, s.r, s.home) - homeChance(s.k, s.r, s.home)));
    }
    // Where the tables are least smooth: a hair either side of each singular radius, k ≤ 6 (the largest prize per home).
    for (const home of HOMES) {
      const prize = Math.max(...STEPS.map((n) => prizeFor(n, home)));
      for (let k = 1; k <= 6; k++) {
        for (const b of singularRadii(k, home)) {
          for (const r of [b - 1e-6, b + 1e-6, b - 1e-3, b + 1e-3]) {
            if (!(r > 1e-6) || verdict(k, r, home)) continue;
            worst = Math.max(worst, prize * Math.abs(nextValue(k, r, home) - homeChance(k, r, home)));
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-7);
  });

  it('martingale (sampled): 100k real steps at a spread of states average back to V within 4 SE', () => {
    const rng = createRng(seededSource(515));
    const states = reachedStates(5, rng).filter((s) => s.k >= 1);
    for (const s of states) {
      const prize = prizeFor(s.n, s.home);
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const v = prize * valueAt(s.k - 1, dist(stepFrom({ x: 0, y: -s.r }, rng.next() * 2 * Math.PI)), s.home);
        sum += v;
        sum2 += v * v;
      }
      const mean = sum / SAMPLES;
      const se = Math.sqrt(Math.max(0, sum2 / SAMPLES - mean * mean) / SAMPLES);
      expect(Math.abs(mean - s.cash)).toBeLessThan(4 * se + 1e-9);
    }
  });

  it('strategies (a)–(e) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { steps, home } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(steps, home, stop, r), ROUNDS, 8100 + 13 * ci + si);
        rows.push(`${label.padEnd(30)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(prizeFor(steps, home) + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
