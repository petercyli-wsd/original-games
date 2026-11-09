// Fairness audit: can any way of playing Sixes beat the RTP?
//
// The only decision is at the two checkpoints (after roll 1 and roll 2):
// cash out at prize · P(win | f free, r rolls left), or roll the free dice.
// The dice count is locked once the stake is placed, holding sixes is
// automatic, and the first roll is part of the bet (a priced step: its
// expected value after the roll is RTP). The state (n, f, r) is all that
// matters, so every strategy is a stopping rule on a small Markov chain.
//
// Binding checks are exact:
//   - the martingale step at every reachable checkpoint (all of them, not a
//     sample): E[value after the roll] = value now, enumerating new sixes;
//   - the real `face()` on the 2^32 RNG grid gives a six with chance 1/6
//     (to 2^-32), so the enumeration matches what the game draws;
//   - every deterministic stopping rule (each subset of checkpoint states at
//     which to cash, 2^(2n) rules, ≤ 1024) is worth exactly RTP.
// Monte Carlo then plays the strategies on the real `face()` with a seeded
// RNG: (a) the tester's rule, (b) take any profit, (c) play to the end,
// (d) cash only after a bad roll / the Auto targets / the eval mix.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DICE, MAX_MULTIPLIER, ROLLS, RTP, cashOutFor, face, nextRoll, prizeFor, startChance, winChance } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 200_000);
const GRID = 2 ** 32;

/** A checkpoint: f dice still need a six with r rolls left (after roll ROLLS − r). */
interface State {
  f: number;
  r: number;
}

/** Every checkpoint reachable with n dice: after roll 1 (r = 2) or roll 2 (r = 1), with 1..n dice still free. */
const checkpoints = (n: number): State[] => {
  const out: State[] = [];
  for (let r = ROLLS - 1; r >= 1; r--) for (let f = 1; f <= n; f++) out.push({ f, r });
  return out;
};

/** Value after one roll from (f, r), outcome k new sixes: the game's finish / checkpoint rule. */
const after = (n: number, f: number, r: number, k: number) => {
  const free = f - k;
  if (free === 0) return prizeFor(n);
  if (r - 1 === 0) return 0;
  return cashOutFor(n, free, r - 1);
};

/** Exact value of a stopping rule `stop(f, r)` from (f, r), rolling when it says no. */
function ruleValue(n: number, f: number, r: number, stop: (s: State) => boolean, atStart = false): number {
  if (!atStart && stop({ f, r })) return cashOutFor(n, f, r);
  let e = 0;
  for (const o of nextRoll(f, r)) {
    const free = f - o.sixes;
    const v = free === 0 ? prizeFor(n) : r - 1 === 0 ? 0 : ruleValue(n, free, r - 1, stop);
    e += o.prob * v;
  }
  return e;
}

/** RTP = mean payout per unit stake, with its standard error. */
function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const m = play(rng);
    s += m;
    s2 += m * m;
    if (m > max) max = m;
  }
  const mean = s / rounds;
  return { rtp: mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

type Policy = (n: number, f: number, r: number) => boolean; // true = cash out at this checkpoint

/** One round as the game plays it: the first roll is part of the bet, then the policy decides at each checkpoint. */
function playRound(n: number, rng: Rng, cash: Policy): number {
  let free = n;
  for (let rolls = 0; rolls < ROLLS; ) {
    let sixes = 0;
    for (let i = 0; i < free; i++) if (face(rng.next()) === 6) sixes++;
    free -= sixes;
    rolls++;
    if (free === 0) return prizeFor(n);
    const left = ROLLS - rolls;
    if (left === 0) return 0;
    if (cash(n, free, left)) return cashOutFor(n, free, left);
  }
  return 0;
}

const POLICIES: Record<string, Policy> = {
  // (a) Roll only when the roll's chance of not losing the round is ≥ 0.8. Before
  // the last roll nothing can lose (survival 1); the last roll survives only on
  // all sixes, (1/6)^f < 0.8, so (a) always cashes before roll 3.
  '(a) roll iff P(survive roll) ≥ 0.8': (_n, f, r) => (r === 1 ? (1 / 6) ** f : 1) < 0.8,
  // (b) Cash out the moment the value is above the stake.
  '(b) cash once V > 1': (n, f, r) => cashOutFor(n, f, r) > 1,
  // (c) Never cash out.
  '(c) play to the end': () => false,
  // (d1) Cut losses: cash out after a roll that made no progress, ride good ones.
  '(d1) cash only after a bad roll': (n, f, r) => winChance(f, r) < startChance(n),
  // (d2) The opposite: lock in after a good roll.
  '(d2) cash only after a good roll': (n, f, r) => winChance(f, r) > startChance(n),
  // (d3) The Auto rule at 3×: cash once the value reaches 3.
  '(d3) Auto at 3×': (n, f, r) => cashOutFor(n, f, r) >= 3 - 1e-12,
};

describe('Sixes fairness', () => {
  it('the real face() makes a six with chance 1/6 on the 2^32 RNG grid', () => {
    // face(u) = 6 iff floor(6u) ≥ 5 iff u ≥ 5/6: count the j with j / 2^32 ≥ 5/6, then check face() at the boundary.
    const first = Math.ceil((5 * GRID) / 6);
    expect(face(first / GRID)).toBe(6);
    expect(face((first - 1) / GRID)).toBe(5);
    const p = (GRID - first) / GRID;
    expect(Math.abs(p - 1 / 6)).toBeLessThanOrEqual(1 / GRID);
    // Every face's bucket is within one grid step of 1/6.
    for (let k = 0; k < 6; k++) {
      const lo = Math.ceil((k * GRID) / 6);
      const hi = Math.ceil(((k + 1) * GRID) / 6);
      expect(face(lo / GRID)).toBe(k + 1);
      expect(face((hi - 1) / GRID)).toBe(k + 1);
      expect(Math.abs((hi - lo) / GRID - 1 / 6)).toBeLessThanOrEqual(1 / GRID);
    }
  });

  it('martingale: at every reachable checkpoint (and at the bet), E[value after the roll] = value now, exactly', () => {
    let states = 0;
    for (const n of DICE) {
      // The bet: the first roll is part of it, and its expected result is RTP.
      const first = nextRoll(n, ROLLS).reduce((e, o) => e + o.prob * after(n, n, ROLLS, o.sixes), 0);
      expect(Math.abs(first - RTP)).toBeLessThan(1e-12);
      for (const { f, r } of checkpoints(n)) {
        const outs = nextRoll(f, r);
        expect(Math.abs(outs.reduce((s, o) => s + o.prob, 0) - 1)).toBeLessThan(1e-14);
        const now = cashOutFor(n, f, r);
        const e = outs.reduce((s, o) => s + o.prob * after(n, f, r, o.sixes), 0);
        expect(Math.abs(e - now)).toBeLessThan(1e-12 * Math.max(1, now));
        // Cash-out is never above the prize, and the prize is the manifest bound.
        expect(now).toBeLessThanOrEqual(prizeFor(n) + 1e-12);
        states++;
      }
    }
    expect(states).toBe(30);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('exhaustive: every deterministic stopping rule (cash at any subset of checkpoints) is worth exactly RTP', () => {
    let rules = 0;
    let worst = 0;
    for (const n of DICE) {
      const cps = checkpoints(n);
      for (let mask = 0; mask < 1 << cps.length; mask++) {
        const stop = (s: State) => {
          const i = cps.findIndex((c) => c.f === s.f && c.r === s.r);
          return ((mask >> i) & 1) === 1;
        };
        const v = ruleValue(n, n, ROLLS, stop, true);
        worst = Math.max(worst, Math.abs(v - RTP));
        rules++;
      }
    }
    expect(rules).toBe(4 + 16 + 64 + 256 + 1024);
    expect(worst).toBeLessThan(1e-12);
  });

  it('strategies: (a)–(d) on the real dice for every eval config, plus the eval mix: RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const n = params.n;
      Object.entries(POLICIES).forEach(([name, policy], pi) => {
        // Exact value of the same rule (the binding check), then the sample.
        const exact = ruleValue(n, n, ROLLS, (s) => policy(n, s.f, s.r), true);
        expect(Math.abs(exact - RTP)).toBeLessThan(1e-12);
        const r = mc((rng) => playRound(n, rng, policy), ROUNDS, 9100 + 10 * ci + pi);
        rows.push(`${label.padEnd(20)} ${name.padEnd(36)} ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%  max ${r.max.toFixed(2)}`);
        expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
      const e = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 9900 + ci);
      rows.push(`${label.padEnd(20)} ${'eval mix'.padEnd(36)} ${(e.rtp * 100).toFixed(3)}% ± ${(e.se * 100).toFixed(3)}%`);
      expect(Math.abs(e.rtp - RTP)).toBeLessThan(4 * e.se);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
