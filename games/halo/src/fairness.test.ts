// Fairness audit: can any way of playing Halo beat the RTP?
//
// Arc and ring count are fixed at the bet (slider and chips are disabled
// while live). Bet walks the first leg at once (or releases at once with no
// rings); at each ring the player may cash out (prize · ω(z)), drift to the
// next ring, or release. Game.tsx draws a whole leg with leg() and a release
// with release() before animating it; every button is hidden while it
// animates, and a `stepping` ref blocks a second action in the same tick.
//
// Checks:
//   - martingale at ≥ 30 states reached by playing random rounds (every eval
//     config and ring count, early and last rings):
//       · release: pays prize iff u < ω(z), so E = prize · ω exactly; a sweep
//         of u confirms the share of winning u is ω;
//       · drift, the exact parts: the ring-hit sampler ringHit(z, ρ, u) and a
//         walk-on-circles hop, each averaged over u (or the hop angle) by the
//         periodic trapezoid rule, equal ω(z) to 1e-9;
//       · drift, the whole leg() as played: 100k Monte Carlo legs per state,
//         within 4 SE (3 states here; the heavy run does all of them);
//   - strategies, Monte Carlo through leg() and release() (no finite tree):
//       (a) the tester's: act only when the next step is ≥ 80% safe. A drift
//           can't lose, so it drifts to the last ring, then releases only if
//           ω ≥ 0.8, else cashes out;
//       (b) take any profit: cash out the moment the cash-out exceeds the bet,
//           else drift; release at the last ring;
//       (c) play to the end: every ring, then release;
//       (d) read the halo: release at once when ω has doubled from the start,
//           cash out when it has halved, else drift; at the last ring release
//           if ω is at least the start chance, else cash out.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  CENTRE,
  HOP,
  MAX_MULTIPLIER,
  RINGS,
  RTP,
  TAU,
  cashOut,
  leg,
  norm,
  prize,
  release,
  ringHit,
  ringRadii,
  startChance,
  winChance,
  type Pt,
  type Rings,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (and checks every state by Monte Carlo). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 3_000);
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS;

interface Spot {
  arc: number;
  radii: number[];
  /** Rings reached (the next leg goes to radii[reached]). */
  reached: number;
  z: Pt;
}

type Act = 'cash' | 'drift' | 'release';
type Policy = (s: Spot) => Act;

const atLast = (s: Spot) => s.reached >= s.radii.length;

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) act only while ≥ 80% safe', policy: (s) => (!atLast(s) ? 'drift' : winChance(s.z, s.arc) >= 0.8 ? 'release' : 'cash') },
  { name: '(b) take any profit', policy: (s) => (cashOut(s.z, s.arc) > 1 ? 'cash' : atLast(s) ? 'release' : 'drift') },
  { name: '(c) play to the end', policy: (s) => (atLast(s) ? 'release' : 'drift') },
  {
    name: '(d) read the halo',
    policy: (s) => {
      const w = winChance(s.z, s.arc);
      const p0 = startChance(s.arc);
      if (atLast(s)) return w >= p0 ? 'release' : 'cash';
      return w >= 2 * p0 ? 'release' : w <= p0 / 2 ? 'cash' : 'drift';
    },
  },
];

/** One round as Game.tsx plays it: Bet takes the first leg (or releases with no rings), then the policy acts at each ring. */
function play(arc: number, rings: Rings, policy: Policy, rng: Rng): number {
  const s: Spot = { arc, radii: ringRadii(rings), reached: 0, z: CENTRE };
  let act: Act = s.radii.length ? 'drift' : 'release';
  for (;;) {
    if (act === 'cash') return cashOut(s.z, arc);
    if (act === 'release') return release(s.z, arc, rng.next()).win ? prize(arc) : 0;
    const path = leg(s.z, s.radii[s.reached], rng.next);
    s.z = path[path.length - 1];
    s.reached++;
    act = policy(s);
    if (act === 'drift' && atLast(s)) throw new Error('policy drifted past the last ring');
  }
}

/** Rings reached while playing random rounds with random actions (eval configs and every ring count). */
function reachedStates(count: number, rng: Rng): Spot[] {
  const settings = [...evalSpec.configs.map((c) => c.params), ...RINGS.filter((r) => r > 0).map((rings, i) => ({ arc: [15, 120, 200][i], rings }))];
  const out: Spot[] = [];
  for (let i = 0; out.length < count; i++) {
    const { arc, rings } = settings[i % settings.length];
    const s: Spot = { arc, radii: ringRadii(rings), reached: 0, z: CENTRE };
    while (!atLast(s)) {
      const path = leg(s.z, s.radii[s.reached], rng.next);
      s.z = path[path.length - 1];
      s.reached++;
      out.push({ ...s });
      if (rng.next() < 0.25) break;
    }
  }
  return out.slice(0, count);
}

/** Periodic trapezoid rule on [0, 1). */
function circleMean(f: (u: number) => number, n = 8192) {
  let s = 0;
  for (let i = 0; i < n; i++) s += f((i + 0.5) / n);
  return s / n;
}

function mc(play_: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play_(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Halo fairness', () => {
  const states = reachedStates(36, createRng(seededSource(31)));

  it('reached states cover every config, early and last rings', () => {
    expect(states.length).toBeGreaterThanOrEqual(30);
    expect(states.some(atLast)).toBe(true);
    expect(states.some((s) => s.reached === 1)).toBe(true);
    expect(new Set(states.map((s) => `${s.arc}|${s.radii.length}`)).size).toBeGreaterThanOrEqual(6);
  });

  it('release is a fair bet: it pays the prize for exactly a share ω(z) of u', () => {
    for (const s of [...states, { arc: 90, radii: [], reached: 0, z: CENTRE }]) {
      const w = winChance(s.z, s.arc);
      const N = 4000;
      let wins = 0;
      for (let j = 0; j < N; j++) if (release(s.z, s.arc, (j + 0.5) / N).win) wins++;
      expect(Math.abs(wins / N - w)).toBeLessThanOrEqual(1 / N + 1e-12);
      expect(release(s.z, s.arc, Math.max(0, w - 1e-9)).win).toBe(w > 1e-9);
      expect(release(s.z, s.arc, Math.min(1 - 1e-12, w + 1e-9)).win).toBe(false);
      expect(prize(s.arc) * w).toBeCloseTo(cashOut(s.z, s.arc), 12);
      expect(cashOut(s.z, s.arc)).toBeLessThanOrEqual(prize(s.arc) * (1 + 1e-12));
    }
  });

  it('drift, exact parts: the ring-hit sampler and a single hop average ω to ω(z)', () => {
    for (const s of states) {
      if (atLast(s)) continue;
      const V = winChance(s.z, s.arc);
      const rho = s.radii[s.reached];
      expect(Math.abs(circleMean((u) => winChance(ringHit(s.z, rho, u), s.arc)) - V)).toBeLessThan(1e-9);
      const r = HOP * (rho - norm(s.z));
      expect(Math.abs(circleMean((u) => winChance({ x: s.z.x + r * Math.cos(TAU * u), y: s.z.y + r * Math.sin(TAU * u) }, s.arc)) - V)).toBeLessThan(1e-9);
    }
    // From the centre too (the opening leg).
    for (const { arc, rings } of evalSpec.configs.map((c) => c.params)) {
      const rho = ringRadii(rings)[0];
      expect(Math.abs(circleMean((u) => winChance(ringHit(CENTRE, rho, u), arc)) - startChance(arc))).toBeLessThan(1e-9);
    }
  });

  it('drift, as played: E[cash-out after leg()] = cash-out now (100k legs per state, 4 SE)', () => {
    const opening = evalSpec.configs.map((c) => ({ arc: c.params.arc, radii: ringRadii(c.params.rings), reached: 0, z: CENTRE }));
    const live = [...opening, ...states.filter((s) => !atLast(s))];
    const picked = HEAVY ? live : live.filter((_, i) => i % Math.ceil(live.length / 3) === 0);
    for (const s of picked) {
      const V = cashOut(s.z, s.arc);
      const rho = s.radii[s.reached];
      const r = mc(
        (g) => {
          const path = leg(s.z, rho, g.next);
          return cashOut(path[path.length - 1], s.arc);
        },
        100_000,
        Math.round(1e6 * (s.z.x + 2) + s.arc),
      );
      if (HEAVY) console.log(`leg | arc ${s.arc} ring ${s.reached + 1}/${s.radii.length} | V ${V.toFixed(5)} | E ${r.mean.toFixed(5)} ± ${r.se.toFixed(5)} | z ${((r.mean - V) / r.se).toFixed(2)}`);
      expect(Math.abs(r.mean - V)).toBeLessThanOrEqual(4 * r.se + 1e-9);
    }
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const { arc, rings } = cfg.params;
      const r = mc((g) => play(arc, rings, policy, g), ROUNDS, 600 + i * 19 + name.length);
      if (HEAVY) console.log(`${name} | ${cfg.label} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | max ${r.max.toFixed(2)}`);
      expect(Math.abs(r.mean - RTP)).toBeLessThanOrEqual(4 * r.se + 1e-9);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    });
  });
});
