// Fairness audit: can any way of playing Branching beat the RTP?
//
// The round is a Galton–Watson process. At a checkpoint the player sees the
// whole tree, but the lines alive now are i.i.d. and memoryless, so the future
// depends only on (g, z): the generation reached and the number of live nodes.
// The cash-out is V(g, z) = prize × (1 − q_{G−g}^z), and every ending (die-out,
// reaching G, the POP_CAP auto cash-out) pays that same function, so V is a
// bounded martingale and optional stopping gives RTP for every rule.
//
// Decisions mid-round: only cash out or grow (family and generations are locked
// while live). Space and the button both call grow(round); there is no auto
// mode. So every strategy is a stopping rule on the (g, z) chain.
//
// Checks, all with the game's own functions (sampleChildren, cashValue,
// childrenDistribution, POP_CAP), replaying Game.tsx's grow() settlement:
//   - the sampler draws 0–3 children with exactly the stated law;
//   - childrenDistribution(z) equals brute-force enumeration of z nodes;
//   - martingale: at EVERY checkpoint state of every setting (not just 30),
//     E[V after the next generation] = V now, exactly (1e-12), the next
//     generation enumerated through the exact z-fold law;
//   - optimal stopping: the Snell envelope (the best any rule can do) equals V
//     at every state, so no strategy beats RTP;
//   - strategies (a)–(d) exactly (forward DP over z) on all 16 settings, and
//     by Monte Carlo through the real sampler on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { FAMILIES, GENERATIONS, OFFSPRING, POP_CAP, RTP, cashValue, childrenDistribution, prize, sampleChildren, winChance, type Family } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy-*.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 10_000);

const SETTINGS = FAMILIES.flatMap((family) => GENERATIONS.map((gens) => ({ family, gens: gens as number })));

/** What Game.tsx's grow() does once generation g1 has z1 nodes: settle (over) or a checkpoint at V. */
function afterGrow(family: Family, gens: number, g1: number, z1: number): { over: boolean; value: number } {
  const cash = cashValue(family, gens, g1, z1);
  if (z1 === 0) return { over: true, value: 0 };
  if (g1 >= gens) return { over: true, value: cash };
  if (z1 > POP_CAP) return { over: true, value: cash };
  return { over: false, value: cash };
}

/** A stopping rule at a checkpoint (g, z): true = cash out. */
type Stop = (family: Family, gens: number, g: number, z: number) => boolean;

const p0 = (f: Family) => OFFSPRING[f][0];
const STRATEGIES: { name: string; stop: Stop }[] = [
  // The next generation "survives" unless every live node has 0 children: 1 − p0^z.
  { name: '(a) grow while P(next gen alive) ≥ 0.8', stop: (f, _G, _g, z) => 1 - p0(f) ** z < 0.8 },
  { name: '(b) take any profit', stop: (f, G, g, z) => cashValue(f, G, g, z) > 1 },
  { name: '(c) grow to the end', stop: () => false },
  // Ride the single-line (high-variance) spots, bank as soon as a second line
  // gives a profit, and bail when the next generation could wipe out ≥ 30%.
  { name: '(d) ride 1 line, bank 2+ in profit, bail at 30% wipe-out', stop: (f, G, g, z) => z >= 2 && (cashValue(f, G, g, z) > 1 || p0(f) ** z >= 0.3) },
];

/** Exact expected payout of a stopping rule, pushing the distribution of z forward a generation at a time. */
function exactValue(family: Family, gens: number, stop: Stop): number {
  // Generation 0 is the seed; Bet grows generation 1 straight away (no decision at g = 0).
  let dist = new Map<number, number>([[1, 1]]);
  let ev = 0;
  for (let g = 0; g < gens; g++) {
    const next = new Map<number, number>();
    for (const [z, m] of dist) {
      if (g > 0 && stop(family, gens, g, z)) {
        ev += m * cashValue(family, gens, g, z);
        continue;
      }
      childrenDistribution(family, z).forEach((pz, z1) => {
        if (pz === 0) return;
        const r = afterGrow(family, gens, g + 1, z1);
        if (r.over) ev += m * pz * r.value;
        else next.set(z1, (next.get(z1) ?? 0) + m * pz);
      });
    }
    dist = next;
  }
  expect(dist.size).toBe(0);
  return ev;
}

/** One round through the real sampler, exactly as Game.tsx grows it. */
function playRound(family: Family, gens: number, stop: Stop, rng: Rng): number {
  let z = 1;
  for (let g = 0; ; g++) {
    if (g > 0 && stop(family, gens, g, z)) return cashValue(family, gens, g, z);
    let z1 = 0;
    for (let i = 0; i < z; i++) z1 += sampleChildren(family, rng.next());
    const r = afterGrow(family, gens, g + 1, z1);
    if (r.over) return r.value;
    z = z1;
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

describe('Branching fairness', () => {
  it('the sampler draws 0–3 children with exactly the stated law (inverse-CDF boundaries)', () => {
    for (const f of FAMILIES) {
      const p = OFFSPRING[f];
      expect(p[0] + p[1] + p[2] + p[3]).toBeCloseTo(1, 15);
      // u ∈ [0, 1) maps to k on [P(<k), P(≤k)): check just inside every boundary.
      let acc = 0;
      for (let k = 0; k < 4; k++) {
        const lo = acc;
        acc += p[k];
        expect(sampleChildren(f, lo + 1e-12)).toBe(k);
        if (k < 3) expect(sampleChildren(f, acc - 1e-12)).toBe(k);
      }
      expect(sampleChildren(f, 0)).toBe(0);
      expect(sampleChildren(f, 1 - 2 ** -32)).toBe(3);
    }
  });

  it('childrenDistribution(z) equals brute-force enumeration of z nodes', () => {
    for (const f of FAMILIES) {
      for (let z = 0; z <= 4; z++) {
        const brute = new Array<number>(3 * z + 1).fill(0);
        const rec = (i: number, sum: number, pr: number) => {
          if (i === z) return void (brute[sum] += pr);
          for (let k = 0; k < 4; k++) rec(i + 1, sum + k, pr * OFFSPRING[f][k]);
        };
        rec(0, 0, 1);
        const d = childrenDistribution(f, z);
        brute.forEach((b, n) => expect(Math.abs(d[n] - b)).toBeLessThan(1e-15));
      }
    }
  });

  it('martingale at every checkpoint of every setting: E[V after the next generation] = V now', () => {
    let states = 0;
    let worst = 0;
    for (const { family, gens } of SETTINGS) {
      // The value at the start (g = 0, one seed) is RTP.
      expect(cashValue(family, gens, 0, 1)).toBeCloseTo(RTP, 12);
      for (let g = 0; g < gens; g++) {
        for (let z = 1; z <= POP_CAP; z++) {
          const v = cashValue(family, gens, g, z);
          let ev = 0;
          childrenDistribution(family, z).forEach((pz, z1) => (ev += pz * afterGrow(family, gens, g + 1, z1).value));
          worst = Math.max(worst, Math.abs(ev - v) / v);
          states++;
        }
      }
    }
    expect(states).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('optimal stopping: the Snell envelope equals the cash-out everywhere, so no rule beats RTP', () => {
    for (const { family, gens } of SETTINGS) {
      // U(g, z) = max(cash now, E[U after one more generation]); terminal states pay afterGrow().
      let U = new Map<number, number>();
      for (let g = gens - 1; g >= 0; g--) {
        const prev = new Map<number, number>();
        for (let z = 1; z <= POP_CAP; z++) {
          let cont = 0;
          childrenDistribution(family, z).forEach((pz, z1) => {
            const r = afterGrow(family, gens, g + 1, z1);
            cont += pz * (r.over ? r.value : U.get(z1)!);
          });
          const v = cashValue(family, gens, g, z);
          prev.set(z, g === 0 ? cont : Math.max(v, cont));
          expect(Math.abs(prev.get(z)! - v)).toBeLessThan(1e-12 * Math.max(1, v));
        }
        U = prev;
      }
      expect(U.get(1)!).toBeCloseTo(RTP, 12);
    }
  });

  it('strategies (a)–(d) return exactly RTP on all 16 settings (exact DP over z)', () => {
    for (const { family, gens } of SETTINGS) {
      for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(family, gens, stop) - RTP)).toBeLessThan(1e-12);
    }
  });

  it('strategies (a)–(d) through the real sampler on every eval config: RTP within 4 SE, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      const { family, gens } = cfg.params;
      STRATEGIES.forEach(({ name, stop }, si) => {
        const exact = exactValue(family, gens, stop);
        const { mean, se, max } = mc((r) => playRound(family, gens, stop, r), ROUNDS, 7100 + 13 * ci + si);
        rows.push(`${cfg.label.padEnd(30)} ${name.padEnd(58)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exact * 100).toFixed(4)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
        expect(max).toBeLessThanOrEqual(prize(family, gens) + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it('the auto cash-out above POP_CAP pays the fair value, which never exceeds the prize', () => {
    for (const { family, gens } of SETTINGS) {
      for (let g = 1; g < gens; g++) {
        const r = afterGrow(family, gens, g, POP_CAP + 1);
        expect(r.over).toBe(true);
        expect(r.value).toBeLessThanOrEqual(prize(family, gens));
        expect(r.value).toBeCloseTo(prize(family, gens) * winChance(family, gens, g, POP_CAP + 1), 12);
      }
    }
  });
});
