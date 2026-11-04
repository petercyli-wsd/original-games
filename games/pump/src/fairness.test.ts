// Fairness audit: can any way of playing Pump beat the RTP?
//
// The pop positions (a uniform d-subset of 25) are drawn with the host RNG when
// the bet is placed; Bet makes the first pump at once. At each checkpoint the
// player cashes out at m(d, k) or pumps again. The difficulty is locked while
// live, every button is disabled (and a `busy` ref blocks C / Space) while a
// pump animates, and the ticket reads a ref set to the pump's resolved value
// the moment it starts. So the only decision is when to stop, and the state is
// k (safe pumps so far). Auto plays the same ladder via runAutoRound.
//
// Martingale check: at every state (d, k) of every difficulty the next pump has
// two outcomes, pop with chance d/(25 − k) or safe, so E[V after] is
// enumerated exactly. The pop chance itself is checked on the real
// drawPositions: exactly (every rng.int sequence enumerated) for d = 1 and 3,
// and for every d by P(pop on pump k + 1 | k safe) over 25k layouts (1M in
// the heavy run), 4 SE.
//
// Strategies (stopping rules on k), per eval config: (a) the tester's: pump
// only while the next pump is ≥ 80% safe, else cash out (the first pump is
// forced by Bet); (b) cash out the moment the value exceeds the stake;
// (c) pump to the top of the ladder; (d1) chase 2×: cash out at the first rung
// ≥ 2×; (d2) Auto at every target, through the real runAutoRound. A rule that
// stops at rung K is worth S(d, K)·m(d, K) = RTP exactly; that is asserted for
// every K. Monte Carlo RTP is asserted wherever the stopping rung is reached
// in ≥ 30 rounds of the run (the top of Expert is 1 in 3.3 million).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DIFFICULTIES, MAX_MULTIPLIER, POPS, POSITIONS, RTP, drawPositions, maxPumps, multiplier, playToTarget, popChance, survival } from './math';
import { runAutoRound, stepAt } from './round';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);
/** Layouts per difficulty for the pop-chance check (the heavy run uses 1M). */
const DRAWS = import.meta.env.FAIRNESS_ROUNDS ? 1_000_000 : 25_000;

/** Cash out after k ≥ 1 safe pumps? */
type Stop = (d: number, k: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) tester: pump while next ≥ 80% safe', stop: (d, k) => 1 - popChance(d, k) < 0.8 },
  { name: '(b) cash out the moment value > stake', stop: (d, k) => multiplier(d, k) > 1 },
  { name: '(c) pump to the top', stop: () => false },
  { name: '(d1) chase 2×', stop: (d, k) => multiplier(d, k) >= 2 },
];

/** The rung a stopping rule cashes at (it depends only on k), or the top. */
function stopRung(d: number, stop: Stop) {
  for (let k = 1; k < maxPumps(d); k++) if (stop(d, k)) return k;
  return maxPumps(d);
}

/** One manual round as Game.tsx plays it: pops drawn at the bet, first pump at once, auto cash-out at the top. */
function playRound(d: number, stop: Stop, rng: Rng): number {
  const positions = drawPositions(rng, d);
  let k = 0;
  for (;;) {
    const step = stepAt(positions, d, k);
    if (step.kind === 'pop') return 0;
    k = step.pump;
    if (k >= maxPumps(d)) return step.cash;
    if (stop(d, k)) return step.cash;
  }
}

function mc(f: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = f(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** An Rng that replays a scripted sequence of int() results (for exact enumeration). */
function scripted(ints: number[]): Rng {
  let i = 0;
  return { next: () => 0, int: () => ints[i++], shuffle: (xs) => xs.slice() };
}

describe('Pump fairness', () => {
  it('martingale (exact): at every state of every difficulty, E[value after the next pump] = value now', () => {
    let states = 0;
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let k = 0; k < maxPumps(d); k++) {
        states++;
        const q = popChance(d, k);
        expect(q).toBeGreaterThan(0);
        expect(q).toBeLessThan(1);
        expect(Math.abs((1 - q) * multiplier(d, k + 1) - multiplier(d, k))).toBeLessThan(1e-12 * multiplier(d, k + 1));
        expect(Math.abs(survival(d, k) * multiplier(d, k) - RTP)).toBeLessThan(1e-12);
      }
      // q = 1 is never offered: the round auto-cashes at the top.
      expect(popChance(d, maxPumps(d))).toBe(1);
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('drawPositions is a uniform d-subset: exact over every rng.int sequence for d = 1, 3', () => {
    for (const d of [1, 3]) {
      const counts = new Map<string, number>();
      const walk = (prefix: number[]) => {
        if (prefix.length === d) {
          const key = drawPositions(scripted(prefix), d)
            .flatMap((p, i) => (p ? [i] : []))
            .join(',');
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return;
        }
        for (let v = 0; v < POSITIONS - prefix.length; v++) walk([...prefix, v]);
      };
      walk([]);
      const subsets = d === 1 ? 25 : (25 * 24 * 23) / 6;
      expect(counts.size).toBe(subsets);
      const each = [...counts.values()];
      expect(Math.min(...each)).toBe(Math.max(...each));
    }
  });

  it('on the real drawPositions, P(pop on pump k+1 | k safe) = d/(25 − k) (25k draws per difficulty here, 1M in the heavy run; 4 SE)', () => {
    const rng = createRng(seededSource(6601));
    const draws = DRAWS;
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      const reached = new Array(maxPumps(d) + 1).fill(0);
      const popped = new Array(maxPumps(d) + 1).fill(0);
      for (let i = 0; i < draws; i++) {
        const pos = drawPositions(rng, d);
        if (pos.filter(Boolean).length !== d) throw new Error('wrong pop count');
        for (let k = 0; k < maxPumps(d); k++) {
          reached[k]++;
          if (pos[k]) {
            popped[k]++;
            break;
          }
        }
      }
      for (let k = 0; k < maxPumps(d); k++) {
        if (reached[k] < 2000) continue;
        const q = popChance(d, k);
        expect(Math.abs(popped[k] / reached[k] - q)).toBeLessThanOrEqual(4 * Math.sqrt((q * (1 - q)) / reached[k]));
      }
    }
  });

  it('Auto and manual are the same maths: runAutoRound pays what pumping by hand to the target pays', async () => {
    const rng = createRng(seededSource(6602));
    for (let i = 0; i < 2000; i++) {
      const d = POPS[DIFFICULTIES[rng.int(4)]];
      const target = 1 + rng.int(maxPumps(d));
      const positions = drawPositions(rng, d);
      let settled: number | null = null;
      const auto = await runAutoRound({ positions, d, target, animate: async () => true, settle: (m) => (settled = m) });
      const manual = playToTarget(positions, d, target);
      expect(auto).toBe(manual.multiplier);
      expect(settled).toBe(manual.multiplier);
    }
  });

  it('every stopping rung (so every rule, every Auto target) is worth exactly RTP', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let K = 1; K <= maxPumps(d); K++) expect(Math.abs(survival(d, K) * multiplier(d, K) - RTP)).toBeLessThan(1e-12);
      for (const { stop } of STRATEGIES) {
        const K = stopRung(d, stop);
        expect(Math.abs(survival(d, K) * multiplier(d, K) - RTP)).toBeLessThan(1e-12);
      }
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE with the host RNG, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const d = params.pops;
      const runs = [
        ...STRATEGIES,
        { name: '(d2) Auto, random target each round', stop: null as Stop | null },
      ];
      runs.forEach(({ name, stop }, si) => {
        let res;
        let sampled: boolean;
        if (stop) {
          res = mc((rng) => playRound(d, stop, rng), ROUNDS, 9100 + 17 * ci + si);
          sampled = survival(d, stopRung(d, stop)) * ROUNDS >= 30;
        } else {
          // Auto targets limited to rungs the run can see; every rung is exactly RTP (above).
          const T: number[] = [];
          for (let K = 1; K <= maxPumps(d); K++) if (survival(d, K) * ROUNDS >= 300) T.push(K);
          res = mc((rng) => {
            const positions = drawPositions(rng, d);
            return playToTarget(positions, d, T[rng.int(T.length)]).multiplier;
          }, ROUNDS, 9100 + 17 * ci + si);
          sampled = true;
        }
        rows.push(`${label} | ${name} | ${(res.mean * 100).toFixed(3)}% ± ${(res.se * 100).toFixed(3)}% | max ${res.max.toFixed(2)}${sampled ? '' : ' (stop rung unsampled: exact check binds)'}`);
        if (sampled) expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
