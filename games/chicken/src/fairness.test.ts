// Fairness audit: can any way of playing Chicken beat the RTP?
//
// The only decision in a round is when to stop (after each safe lane, cash out
// or cross the next one); the difficulty is fixed when the bet is placed. So
// the whole question is whether the cash-out is a martingale:
//   V(k) = multiplier(d, k), and E[V after crossing lane k + 1] = V(k).
// The per-lane hit is enumerated exactly through the game's own buildRoad (its
// int(25) < hits comparison), never re-derived.
//
// Strategies, per eval config (one per difficulty):
//   (a) the tester's: cross while the next lane is ≥ 80% clear, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) cross to the far kerb;
//   (d) the Auto path (cross() to a target in one go), chasing a doubled bet:
//       the first lane whose payout is ≥ 2×, plus every fixed target lane
//       evaluated exactly (manual and Auto must agree).
// Every strategy is checked twice: exactly (backward induction over lanes with
// the enumerated hit chance) to 1e-9, and by Monte Carlo on real roads from
// buildRoad (within 4 standard errors). For the long-shot strategies (crossing
// to the end on Hard or Daredevil) a feasible Monte Carlo cannot reach a 0.3%
// standard error, so the exact check is the binding one there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DIFFICULTIES, DIFFICULTY, LANES, OUT_OF, RTP, buildRoad, cross, laneSafe, multiplier, type Difficulty } from './math';

/**
 * Rounds per Monte Carlo run. The default keeps the file fast; the audit's
 * 200k-round run is this same file with FAIRNESS_ROUNDS=200000 (scratch
 * script fairness/run-heavy.sh).
 */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** Exact chance a lane is hit, by enumerating every value of the int(25) draw buildRoad makes. */
const hitCache = new Map<Difficulty, number>();
function exactHit(d: Difficulty): number {
  const cached = hitCache.get(d);
  if (cached !== undefined) return cached;
  let hit = 0;
  for (let u = 0; u < OUT_OF; u++) {
    const ranges: number[] = [];
    const road = buildRoad(d, (n) => (ranges.push(n), u));
    if (ranges.length !== LANES || ranges.some((n) => n !== OUT_OF)) throw new Error('buildRoad draws something other than 20 × int(25)');
    if (road.some((x) => x !== road[0])) throw new Error('lanes disagree on the same draw');
    if (road[0]) hit++;
  }
  hitCache.set(d, hit / OUT_OF);
  return hit / OUT_OF;
}

/** The cash-out standing on lane k, as the game shows and pays it (lane 0: the stake's fair value). */
const V = (d: Difficulty, k: number) => (k === 0 ? RTP : multiplier(d, k));

type Stop = (d: Difficulty, k: number) => boolean;

/** Exact value of a stopping rule (cash out on lane k ≥ 1 when stop(k); lane 20 pays by itself). */
function exactValue(d: Difficulty, stop: Stop, pay = V): number {
  const h = exactHit(d);
  const value = (k: number): number => {
    if (k === LANES || (k > 0 && stop(d, k))) return pay(d, k);
    return (1 - h) * value(k + 1);
  };
  return value(0);
}

/** One manual round on a real road, exactly as Game.tsx plays it (lane 1 is mandatory: cash-out is disabled on lane 0). */
function playManual(d: Difficulty, stop: Stop, rng: Rng): number {
  const road = buildRoad(d, (n) => rng.int(n));
  let k = 0;
  for (;;) {
    if (road[k]) return 0;
    k++;
    if (k === LANES || stop(d, k)) return multiplier(d, k);
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) cross while ≥ 80% clear', stop: (d) => laneSafe(d) < 0.8 },
  { name: '(b) take any profit', stop: (d, k) => V(d, k) > 1 },
  { name: '(c) cross to the far kerb', stop: () => false },
];

/** (d): the first lane whose payout is at least 2×. */
const doubleTarget = (d: Difficulty) => {
  let t = 1;
  while (t < LANES && multiplier(d, t) < 2) t++;
  return t;
};

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const configs = evalSpec.configs.map((c) => c.params.difficulty);

describe('Chicken fairness', () => {
  it('the eval covers every difficulty', () => {
    expect([...configs].sort()).toEqual([...DIFFICULTIES].sort());
  });

  it('the hit chance drawn by buildRoad is exactly the hits / 25 on screen', () => {
    for (const d of DIFFICULTIES) {
      expect(exactHit(d)).toBe(DIFFICULTY[d].hits / OUT_OF);
      expect(exactHit(d)).toBeCloseTo(1 - laneSafe(d), 15);
    }
  });

  it('martingale: at 30+ reached states, crossing the next lane keeps the cash-out value exactly', () => {
    const rng = createRng(seededSource(7001));
    const states = new Set<string>();
    // Random rounds on random difficulties, recording every lane stood on.
    for (let r = 0; r < 400; r++) {
      const d = DIFFICULTIES[rng.int(DIFFICULTIES.length)];
      const road = buildRoad(d, (n) => rng.int(n));
      for (let k = 0; k < LANES && !road[k]; k++) states.add(`${d}:${k}`);
    }
    // Near the end of the road on every difficulty, reached or not.
    for (const d of DIFFICULTIES) for (const k of [LANES - 2, LANES - 1]) states.add(`${d}:${k}`);
    expect(states.size).toBeGreaterThanOrEqual(30);

    for (const key of states) {
      const [d, ks] = key.split(':') as [Difficulty, string];
      const k = Number(ks);
      // Next event: lane k + 1, every value of its int(25) draw. The road's other
      // lanes are safe; the payout is what cross() (the Auto path) and the manual
      // path (multiplier on a safe lane) both pay.
      let ev = 0;
      for (let u = 0; u < OUT_OF; u++) {
        const lane = buildRoad(d, () => u)[0];
        const road = Array.from({ length: LANES }, (_, i) => (i === k ? lane : false));
        const auto = cross(road, d, k + 1).multiplier;
        const manual = road[k] ? 0 : multiplier(d, k + 1);
        expect(auto).toBe(manual);
        ev += manual / OUT_OF;
      }
      expect(Math.abs(ev - V(d, k)) / V(d, k)).toBeLessThan(1e-12);
    }
  });

  it('exact: every stopping rule and every Auto target is worth RTP on every difficulty', () => {
    for (const d of configs) {
      for (const { stop } of STRATEGIES) expect(exactValue(d, stop)).toBeCloseTo(RTP, 10);
      for (let t = 1; t <= LANES; t++) expect(exactValue(d, (_, k) => k >= t)).toBeCloseTo(RTP, 10);
      // A rule that depends on the payout itself (stop once it passes a goal).
      for (const goal of [1.5, 3, 10, 100]) expect(exactValue(d, (dd, k) => V(dd, k) >= goal)).toBeCloseTo(RTP, 10);
    }
  });

  it('Monte Carlo on real roads: (a)–(d) on every eval config are within 4 SE of RTP', () => {
    const rows: string[] = [];
    configs.forEach((d, ci) => {
      const plays: { name: string; stop: Stop; play: (rng: Rng) => number }[] = [
        ...STRATEGIES.map(({ name, stop }) => ({ name, stop, play: (rng: Rng) => playManual(d, stop, rng) })),
        {
          name: `(d) Auto to lane ${doubleTarget(d)} (first ≥ 2×)`,
          stop: ((_, k) => k >= doubleTarget(d)) as Stop,
          play: (rng: Rng) => cross(buildRoad(d, (n) => rng.int(n)), d, doubleTarget(d)).multiplier,
        },
      ];
      plays.forEach(({ name, stop, play }, si) => {
        const { mean, se } = mc(play, ROUNDS, 9100 + 31 * ci + si);
        // Too few paying rounds to measure (Daredevil's far kerb pays 1 in 27,000): the exact test covers it.
        const paying = exactValue(d, stop, () => 1) * ROUNDS;
        rows.push(`${d.padEnd(9)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%${paying < 25 ? `  (exact only: ${paying.toFixed(1)} paying rounds expected)` : ''}`);
        if (paying >= 25) expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
