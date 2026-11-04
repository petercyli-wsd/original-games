// Fairness audit: can any way of playing Half-Life beat the RTP?
//
// The chamber size and the backed atom are fixed at the bet. Bet runs the
// clock to the first decay at once; then at each checkpoint the player may
// cash out, run the clock to the next decay, or switch to another survivor
// (re-locking the prize at cash / P(new atom last)) and then run the clock.
// Game.tsx draws each decay with sampleDecay() when the clock starts and
// prices it with afterDecay(); every button is disabled while it runs.
//
// The next event (one decay) has finitely many outcomes, so every check is
// exact:
//   - martingale: at ≥ 30 states reached by random rounds (random switching,
//     every eval config and chamber size, down to two survivors), for every
//     atom the player could back, the switch keeps the cash-out and the mean
//     cash-out after the next decay equals it;
//   - strategies: a decay order tree has at most 7! = 5040 leaves, so each
//     policy's RTP is computed exactly by walking the whole tree, then
//     confirmed by Monte Carlo through sampleDecay():
//       (a) the tester's: run the clock only while the next decay is ≥ 80%
//           safe (1 − nextChance), else cash out;
//       (b) take any profit: cash out the moment the cash-out exceeds the bet;
//       (c) hold to the end;
//       (d1) dodge: at every checkpoint switch to the survivor least likely to
//           decay next (the slowest), bank once the cash-out passes 1.5×;
//       (d2) chase: always switch to the fastest survivor (the biggest prize,
//           highest variance) and hold to the end;
//       (d3) flip-flop: switch to the fastest survivor while behind (cash < 1),
//           to the slowest once ahead, and cash out when the next decay is
//           more than 40% likely to be yours.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  COUNTS,
  MAX_MULTIPLIER,
  RTP,
  afterDecay,
  atomsIn,
  fullMask,
  lastChance,
  nextChance,
  prizeFor,
  sampleDecay,
  switchPrize,
  totalRate,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

interface State {
  mask: number;
  backed: number;
  prize: number;
  cash: number;
}

/** At a checkpoint: cash out, or back `atom` (switching if it differs) and run the clock. */
type Act = 'cash' | { atom: number };
type Policy = (s: State) => Act;

const slowest = (mask: number) => atomsIn(mask)[0];
const fastest = (mask: number) => atomsIn(mask).at(-1)!;

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) run only while ≥ 80% safe', policy: (s) => (1 - nextChance(s.mask, s.backed) >= 0.8 ? { atom: s.backed } : 'cash') },
  { name: '(b) take any profit', policy: (s) => (s.cash > 1 ? 'cash' : { atom: s.backed }) },
  { name: '(c) hold to the end', policy: (s) => ({ atom: s.backed }) },
  { name: '(d1) dodge to the slowest, bank at 1.5×', policy: (s) => (s.cash > 1.5 ? 'cash' : { atom: slowest(s.mask) }) },
  { name: '(d2) chase the fastest', policy: (s) => ({ atom: fastest(s.mask) }) },
  {
    name: '(d3) fastest while behind, slowest while ahead',
    policy: (s) => {
      const atom = s.cash < 1 ? fastest(s.mask) : slowest(s.mask);
      return nextChance(s.mask, atom) > 0.4 ? 'cash' : { atom };
    },
  },
];

/** Back `atom` (re-locking the prize if it is a switch). */
function back(s: State, atom: number): State {
  return atom === s.backed ? s : { ...s, backed: atom, prize: switchPrize(s.cash, s.mask, atom) };
}

/** Exact expected payout of running the clock once from s, then following the policy. */
function runValue(s: State, policy: Policy): number {
  const total = totalRate(s.mask);
  let e = 0;
  for (const i of atomsIn(s.mask)) {
    const r = afterDecay(s.prize, s.mask, s.backed, i);
    const v = r.outcome ? r.cash : nodeValue({ mask: r.mask, backed: s.backed, prize: s.prize, cash: r.cash }, policy);
    e += (i / total) * v;
  }
  return e;
}

function nodeValue(s: State, policy: Policy): number {
  const a = policy(s);
  return a === 'cash' ? s.cash : runValue(back(s, a.atom), policy);
}

const startState = (k: number, atom: number): State => ({ mask: fullMask(k), backed: atom, prize: prizeFor(k, atom), cash: RTP });

/** Exact RTP of a policy: Bet runs the clock to the first decay at once. */
const exactRtp = (k: number, atom: number, policy: Policy) => runValue(startState(k, atom), policy);

/** One round as Game.tsx plays it. */
function playRound(k: number, atom: number, policy: Policy, rng: Rng): number {
  let s = startState(k, atom);
  for (;;) {
    const d = sampleDecay(s.mask, rng);
    const r = afterDecay(s.prize, s.mask, s.backed, d.atom);
    if (r.outcome) return r.cash;
    s = { ...s, mask: r.mask, cash: r.cash };
    const a = policy(s);
    if (a === 'cash') return s.cash;
    s = back(s, a.atom);
  }
}

/** Checkpoints met while playing random rounds with random switches. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  for (let i = 0; out.length < count; i++) {
    const k = COUNTS[i % COUNTS.length];
    let s = startState(k, 1 + rng.int(k));
    for (;;) {
      const d = sampleDecay(s.mask, rng);
      const r = afterDecay(s.prize, s.mask, s.backed, d.atom);
      if (r.outcome) break;
      s = { ...s, mask: r.mask, cash: r.cash };
      out.push(s);
      if (rng.next() < 0.5) {
        const atoms = atomsIn(s.mask);
        s = back(s, atoms[rng.int(atoms.length)]);
      }
    }
  }
  return out.slice(0, count);
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

describe('Half-Life fairness', () => {
  it('martingale, exact: at ≥ 30 reached states, every switch keeps the cash-out and every next decay is a fair bet', () => {
    const rng = createRng(seededSource(2024));
    const states = reachedStates(60, rng);
    expect(states.some((s) => atomsIn(s.mask).length === 2)).toBe(true);
    expect(new Set(states.map((s) => s.mask)).size).toBeGreaterThan(20);
    for (const s of states) {
      expect(Math.abs(s.cash - s.prize * lastChance(s.mask, s.backed))).toBeLessThan(1e-12 * s.prize);
      for (const atom of atomsIn(s.mask)) {
        const t = back(s, atom);
        expect(Math.abs(t.prize * lastChance(t.mask, atom) - s.cash)).toBeLessThan(1e-12 * Math.max(1, s.cash));
        const after = runValue(t, () => 'cash');
        expect(Math.abs(after - s.cash)).toBeLessThan(1e-12 * Math.max(1, s.cash));
      }
    }
  });

  it('every bet is worth RTP: the first decay is a fair bet from every chamber and atom', () => {
    for (const k of COUNTS) for (let atom = 1; atom <= k; atom++) expect(exactRtp(k, atom, () => 'cash')).toBeCloseTo(RTP, 12);
  });

  it('sampleDecay draws atom i with exactly the chance shown (i / total rate)', () => {
    const rng = createRng(seededSource(77));
    const n = 200_000;
    for (const mask of [fullMask(7), 0b1010110, 0b0000011]) {
      const counts = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const a = sampleDecay(mask, rng).atom;
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      for (const a of atomsIn(mask)) {
        const q = nextChance(mask, a);
        expect(Math.abs((counts.get(a) ?? 0) / n - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n));
      }
      expect([...counts.keys()].every((a) => atomsIn(mask).includes(a))).toBe(true);
    }
  });

  it('every strategy returns exactly RTP on every eval config and every chamber/atom (whole decay tree)', () => {
    for (const cfg of evalSpec.configs) {
      const { k, atom } = cfg.params;
      for (const { policy } of STRATEGIES) expect(exactRtp(k, atom, policy)).toBeCloseTo(RTP, 10);
    }
    for (const k of COUNTS) for (let atom = 1; atom <= k; atom++) for (const { policy } of STRATEGIES) expect(exactRtp(k, atom, policy)).toBeCloseTo(RTP, 10);
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const { k, atom } = cfg.params;
      const r = mc((g) => playRound(k, atom, policy, g), ROUNDS, 500 + i * 13 + name.length);
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${cfg.label} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | exact ${(exactRtp(k, atom, policy) * 100).toFixed(6)}% | max ${r.max.toFixed(2)}`);
      expect(Math.abs(r.mean - RTP)).toBeLessThanOrEqual(4 * r.se + 1e-9);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    });
  });
});
