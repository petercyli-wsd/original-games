// Fairness audit: can any way of playing Knight beat the RTP?
//
// The target is fixed at the bet, so the only decisions in a round are when to
// stop and how to continue: "Next hop" (one hop) or "Run to the end" (every hop
// until the result is certain). Both draw their hops with `drawHops` exactly as
// Game.tsx's hop() does, and the cash-out after them is computed as hop() does.
//
// Martingale check, exact: at every live state reachable from g1 (every square
// and hops-left pair, for every target the panel offers), the next hop's
// outcomes are enumerated through the real `drawHops` (one uniform pick per
// hop), and for "Run to the end" every pick sequence is enumerated the same
// way. E[cash-out after] must equal the cash-out now to 1e-12. The first hop
// (made for you at the bet) is checked from the start value RTP.
//
// Strategies, per eval config (the target): (a) the tester's: hop while at
// least 80% of the next hops keep a green finish possible, else cash out;
// (b) cash out the moment the cash-out exceeds the bet; (c) play to the end;
// (d) greedy: hop only while at least half the next hops raise the chance,
// else cash out; (e) Run to the end once the chance is ≥ 50%, else cash out.
// Each is valued exactly by enumerating the walk (the binding check, since
// single-square targets pay ~200× and need millions of rounds for a 0.3% SE),
// then played on the real functions with the seeded RNG.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { HOPS, MOVES, RTP, START, allTargets, cashAt, chance, drawHops, prizeFor, startChance, verdict, type Target } from './math';

/** Rounds per strategy run; the heavy audit run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** The cash-out after a press that drew `steps` from a state with `left` hops to go, as Game.tsx's hop() computes it. */
function valueAfter(prize: number, t: Target, steps: number[], left: number): number {
  const last = steps[steps.length - 1];
  const leftAfter = left - steps.length;
  const end = verdict(last, leftAfter, t);
  return end === 'win' ? prize : end === 'lost' ? 0 : cashAt(prize, last, leftAfter, t);
}

/**
 * Runs `f(pick)` for every sequence of uniform picks it can make (an odometer
 * over the choices), with each sequence's probability. f must be deterministic
 * given the picks.
 */
function enumeratePicks<T>(f: (pick: (n: number) => number) => T): { p: number; out: T }[] {
  const results: { p: number; out: T }[] = [];
  const choice: number[] = [];
  for (;;) {
    const sizes: number[] = [];
    const out = f((n) => {
      const d = sizes.length;
      sizes.push(n);
      if (choice.length <= d) choice.push(0);
      return choice[d];
    });
    choice.length = sizes.length;
    results.push({ p: sizes.reduce((a, n) => a / n, 1), out });
    let d = sizes.length - 1;
    while (d >= 0 && choice[d] === sizes[d] - 1) d--;
    if (d < 0) return results;
    choice[d]++;
    choice.length = d + 1;
  }
}

/** Every live checkpoint (square, hops left) the knight can reach from g1 for target t. */
function liveStates(t: Target): { s: number; left: number }[] {
  const out: { s: number; left: number }[] = [];
  let frontier = new Set([START]);
  for (let left = HOPS - 1; left >= 1; left--) {
    const next = new Set<number>();
    for (const x of frontier) for (const y of MOVES[x]) next.add(y);
    for (const y of next) if (!verdict(y, left, t)) out.push({ s: y, left });
    // Only live squares continue (a round ends as soon as the result is certain).
    frontier = new Set([...next].filter((y) => !verdict(y, left, t)));
  }
  return out;
}

type Choice = 'cash' | 'hop' | 'run';
/** A strategy: at a checkpoint with square s, `left` hops to go and cash-out `cash`, what to press. */
type Strategy = (s: number, left: number, cash: number, t: Target) => Choice;

const nextLive = (s: number, left: number, t: Target) => MOVES[s].filter((y) => chance(y, left - 1, t) > 0).length / MOVES[s].length;
const nextUp = (s: number, left: number, t: Target) => MOVES[s].filter((y) => chance(y, left - 1, t) > chance(s, left, t)).length / MOVES[s].length;

const STRATEGIES: { name: string; play: Strategy }[] = [
  { name: '(a) hop while ≥ 80% of hops keep green possible', play: (s, left, _c, t) => (nextLive(s, left, t) >= 0.8 ? 'hop' : 'cash') },
  { name: '(b) take any profit', play: (_s, _l, cash) => (cash > 1 ? 'cash' : 'hop') },
  { name: '(c) play to the end', play: () => 'hop' },
  { name: '(d) hop only while ≥ half the hops raise the chance', play: (s, left, _c, t) => (nextUp(s, left, t) >= 0.5 ? 'hop' : 'cash') },
  { name: '(e) Run to the end once the chance is ≥ 50%', play: (s, left, _c, t) => (chance(s, left, t) >= 0.5 ? 'run' : 'cash') },
];

/** Exact value of a strategy: enumerate every press's outcomes through drawHops. */
function exactRtp(t: Target, play: Strategy): number {
  const prize = prizeFor(t);
  const memo = new Map<string, number>();
  const value = (s: number, left: number): number => {
    const key = `${s}:${left}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const cash = cashAt(prize, s, left, t);
    const c = play(s, left, cash, t);
    const v = c === 'cash' ? cash : press(s, left, c === 'run');
    memo.set(key, v);
    return v;
  };
  const press = (s: number, left: number, all: boolean) =>
    enumeratePicks((pick) => drawHops(s, left, t, all, pick)).reduce((a, { p, out }) => {
      const leftAfter = left - out.length;
      const last = out[out.length - 1];
      return a + p * (verdict(last, leftAfter, t) ? valueAfter(prize, t, out, left) : value(last, leftAfter));
    }, 0);
  // The first hop is made at the bet.
  return press(START, HOPS, false);
}

/** One round on the real functions with the seeded RNG, as Game.tsx plays it. */
function playRound(t: Target, play: Strategy, rng: Rng): number {
  const prize = prizeFor(t);
  let s = START;
  let left = HOPS;
  let all = false;
  for (;;) {
    const steps = drawHops(s, left, t, all, (n) => rng.int(n));
    const v = valueAfter(prize, t, steps, left);
    s = steps[steps.length - 1];
    left -= steps.length;
    if (verdict(s, left, t)) return v;
    const c = play(s, left, v, t);
    if (c === 'cash') return v;
    all = c === 'run';
  }
}

function mc(t: Target, play: Strategy, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = playRound(t, play, rng);
    s1 += x;
    s2 += x * x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const CONFIGS = evalSpec.configs;

describe('Knight fairness', () => {
  it('martingale: at every reachable checkpoint of every target, Next hop keeps E[cash-out] (exact enumeration via drawHops)', () => {
    let checked = 0;
    for (const t of allTargets()) {
      const prize = prizeFor(t);
      // The first hop, made at the bet, from the start value RTP.
      const first = enumeratePicks((pick) => drawHops(START, HOPS, t, false, pick)).reduce((a, { p, out }) => a + p * valueAfter(prize, t, out, HOPS), 0);
      expect(Math.abs(first - RTP)).toBeLessThan(1e-12);
      expect(Math.abs(prize * startChance(t) - RTP)).toBeLessThan(1e-12);
      for (const { s, left } of liveStates(t)) {
        const now = cashAt(prize, s, left, t);
        const after = enumeratePicks((pick) => drawHops(s, left, t, false, pick)).reduce((a, { p, out }) => a + p * valueAfter(prize, t, out, left), 0);
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, prize));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('martingale: Run to the end is worth the cash-out now at every reachable checkpoint (every pick sequence enumerated)', () => {
    const targets = [...CONFIGS.map((c) => c.params.target), allTargets()[0]];
    let checked = 0;
    for (const t of targets) {
      const prize = prizeFor(t);
      for (const { s, left } of liveStates(t)) {
        const now = cashAt(prize, s, left, t);
        const runs = enumeratePicks((pick) => drawHops(s, left, t, true, pick));
        expect(runs.reduce((a, r) => a + r.p, 0)).toBeCloseTo(1, 12);
        const after = runs.reduce((a, { p, out }) => {
          // A run always stops on a certain result (or with no hops left).
          expect(verdict(out[out.length - 1], left - out.length, t)).not.toBeNull();
          return a + p * valueAfter(prize, t, out, left);
        }, 0);
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, prize));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('no payout ever exceeds the prize, and verdicts are exact (chance 0 or 1 only when certain)', () => {
    for (const t of allTargets())
      for (const { s, left } of liveStates(t)) {
        const p = chance(s, left, t);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
        expect(cashAt(prizeFor(t), s, left, t)).toBeLessThan(prizeFor(t));
      }
  });

  for (const cfg of CONFIGS) {
    const t = cfg.params.target;
    it(`exact strategy values, ${cfg.label}: every strategy returns RTP to 1e-12`, () => {
      for (const st of STRATEGIES) expect(Math.abs(exactRtp(t, st.play) - RTP), st.name).toBeLessThan(1e-12);
    });
  }

  it(`Monte Carlo (${ROUNDS} rounds per strategy and config, real drawHops + seeded RNG): within 4 SE of RTP`, () => {
    const rows: string[] = [];
    CONFIGS.forEach((cfg, ci) =>
      STRATEGIES.forEach((st, si) => {
        const r = mc(cfg.params.target, st.play, ROUNDS, 1000 + 10 * ci + si);
        rows.push(`${cfg.label} | ${st.name} | ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}%`);
        expect(Math.abs(r.mean - RTP), `${cfg.label} ${st.name}`).toBeLessThan(4 * r.se + 1e-9);
      }),
    );
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
