// Fairness audit: can any way of playing Chicken beat the RTP?
//
// The only decision in a round is when to stop (after each safe lane, cash out
// or hop the next); the difficulty is fixed when the bet is placed. So the
// question is whether the cash-out is a martingale. The next-slot hazard chance
// is counted from the hazard subsets themselves (C(20 - k - 1, m - 1) of
// C(20 - k, m) subsets put a hazard in the next slot), never re-derived from
// the game's own hazardChance.
//
// Strategies, per eval config (one per difficulty):
//   (a) hop while the next lane is >= 80% safe, else cash out;
//   (b) take any profit: cash out once the cash-out exceeds the bet;
//   (c) hop to the finish;
//   (d) the Auto path (cross() to a target): the first lane paying >= 2x;
//   (e) stop when the next hazard chance first reaches 1/3 (the strongest-looking
//       rule for a rising-risk ladder).
// Each is checked exactly (backward induction) to 1e-9 and by Monte Carlo on real
// roads from buildRoad within 4 SE. Where a strategy pays too rarely to measure
// (Expert to the end, 1 in 184,756), the exact check is the binding one.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DIFFICULTIES, DIFFICULTY, RTP, SLOTS, buildRoad, choose, cross, hazardChance, lanesOf, multiplier, type Difficulty } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** Exact chance the next slot is a hazard after k safe hops, by subset counting. */
const nextHazard = (d: Difficulty, k: number) => {
  const m = DIFFICULTY[d].hazards;
  return choose(SLOTS - k - 1, m - 1) / choose(SLOTS - k, m);
};

/** The cash-out standing on lane k, as the game shows and pays it (lane 0: the stake's fair value). */
const V = (d: Difficulty, k: number) => (k === 0 ? RTP : multiplier(d, k));

type Stop = (d: Difficulty, k: number) => boolean;

function exactValue(d: Difficulty, stop: Stop, pay = V): number {
  const value = (k: number): number => {
    if (k === lanesOf(d) || (k > 0 && stop(d, k))) return pay(d, k);
    return (1 - nextHazard(d, k)) * value(k + 1);
  };
  return value(0);
}

/** One manual round on a real road, exactly as Game.tsx plays it (lane 1 is mandatory). */
function playManual(d: Difficulty, stop: Stop, rng: Rng): number {
  const road = buildRoad(d, (n) => rng.int(n));
  let k = 0;
  for (;;) {
    if (road[k]) return 0;
    k++;
    if (k === lanesOf(d) || stop(d, k)) return multiplier(d, k);
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) hop while >= 80% safe', stop: (d, k) => 1 - nextHazard(d, k) < 0.8 },
  { name: '(b) take any profit', stop: (d, k) => V(d, k) > 1 },
  { name: '(c) hop to the finish', stop: () => false },
  { name: '(e) stop at hazard >= 1/3', stop: (d, k) => nextHazard(d, k) >= 1 / 3 },
];

const doubleTarget = (d: Difficulty) => {
  let t = 1;
  while (t < lanesOf(d) && multiplier(d, t) < 2) t++;
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

  it('the hazard chance shown matches the subset count', () => {
    for (const d of DIFFICULTIES) for (let k = 0; k < lanesOf(d); k++) expect(hazardChance(d, k)).toBeCloseTo(nextHazard(d, k), 12);
  });

  it('martingale: at 30+ reached states, hopping the next lane keeps the cash-out value exactly', () => {
    const rng = createRng(seededSource(7001));
    const states = new Set<string>();
    for (let r = 0; r < 400; r++) {
      const d = DIFFICULTIES[rng.int(DIFFICULTIES.length)];
      const road = buildRoad(d, (n) => rng.int(n));
      for (let k = 0; k < lanesOf(d) && !road[k]; k++) states.add(`${d}:${k}`);
    }
    for (const d of DIFFICULTIES) for (const k of [lanesOf(d) - 2, lanesOf(d) - 1]) states.add(`${d}:${k}`);
    expect(states.size).toBeGreaterThanOrEqual(30);

    for (const key of states) {
      const [d, ks] = key.split(':') as [Difficulty, string];
      const k = Number(ks);
      const q = nextHazard(d, k);
      // Next event: hazard with chance q (pays 0), else the cash-out of lane k + 1; Auto and manual agree.
      const road = Array.from({ length: SLOTS }, () => false);
      expect(cross(road, d, k + 1).multiplier).toBe(multiplier(d, k + 1));
      const ev = (1 - q) * multiplier(d, k + 1);
      expect(Math.abs(ev - V(d, k)) / V(d, k)).toBeLessThan(1e-12);
    }
  });

  it('exact: every stopping rule and every Auto target is worth RTP on every difficulty', () => {
    for (const d of configs) {
      for (const { stop } of STRATEGIES) expect(exactValue(d, stop)).toBeCloseTo(RTP, 10);
      for (let t = 1; t <= lanesOf(d); t++) expect(exactValue(d, (_, k) => k >= t)).toBeCloseTo(RTP, 10);
      for (const goal of [1.5, 3, 10, 100]) expect(exactValue(d, (dd, k) => V(dd, k) >= goal)).toBeCloseTo(RTP, 10);
    }
  });

  it('Monte Carlo on real roads: every strategy on every eval config is within 4 SE of RTP', () => {
    const rows: string[] = [];
    configs.forEach((d, ci) => {
      const plays: { name: string; stop: Stop; play: (rng: Rng) => number }[] = [
        ...STRATEGIES.map(({ name, stop }) => ({ name, stop, play: (rng: Rng) => playManual(d, stop, rng) })),
        {
          name: `(d) Auto to lane ${doubleTarget(d)} (first >= 2x)`,
          stop: ((_, k) => k >= doubleTarget(d)) as Stop,
          play: (rng: Rng) => cross(buildRoad(d, (n) => rng.int(n)), d, doubleTarget(d)).multiplier,
        },
      ];
      plays.forEach(({ name, stop, play }, si) => {
        const { mean, se } = mc(play, ROUNDS, 9100 + 31 * ci + si);
        const paying = exactValue(d, stop, () => 1) * ROUNDS;
        rows.push(`${d.padEnd(8)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% +- ${(se * 100).toFixed(2)}%${paying < 25 ? `  (exact only: ${paying.toFixed(1)} paying rounds expected)` : ''}`);
        if (paying >= 25) expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
