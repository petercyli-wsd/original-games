// Fairness audit: can any way of playing Shells beat the RTP?
//
// A round is 6 dealer moves, then the reveal. After every move the player may
// cash out at V = prize × P(slot), switch to another cup (the prize relocks at
// V / P(new cup)), or play on. The real ball is hidden; the game prices on the
// belief p (where the ball is, given what was seen). So fairness needs:
//   1. p is the exact posterior of the real ball (checked by enumerating every
//      pair sequence and both outcomes of every blind coin through the game's
//      own drawMove / moveBall);
//   2. V is a martingale under every action (continue, or switch then
//      continue): exact average over the n − 1 equally likely pairs;
//   3. hence every strategy is worth RTP: checked exactly (full enumeration of
//      the observable tree, every cup count × blind count × starting cup) and
//      by Monte Carlo with the real ball.
// Strategies, per eval config:
//   (a) the tester's: play on while the next step keeps the cup alive with
//       chance ≥ 0.8 (the reveal: P(ball here) ≥ 0.8), else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the reveal on the starting cup;
//   (d1) chase the ball: switch to the most likely cup at every checkpoint,
//        then reveal; (d2) chase the long shot: switch to the largest prize
//        allowed at every checkpoint, then reveal; (d3) Auto with a 2× target
//        (the game's Auto loop: no switches, cash once V ≥ 2).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BLINDS,
  CUPS,
  MAX_MULTIPLIER,
  MAX_WIN,
  MOVES,
  RTP,
  applyMove,
  canSwitch,
  drawMove,
  finalChances,
  moveBall,
  nextOdds,
  schedule,
  startBelief,
  type Setup,
} from './math';

/** Rounds per Monte Carlo run; the audit's 200k run sets FAIRNESS_ROUNDS (scratch run-heavy script). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

/** An Rng that answers drawMove with a chosen pair and coin. */
function scripted(pair: number, coin: number): Rng {
  return { next: () => coin, int: () => pair, shuffle: (a) => a.slice() };
}

interface State {
  sched: boolean[];
  p: number[];
  done: number;
  slot: number;
  prize: number;
}

type Decision = { cash: true } | { cash: false; slot?: number };
type Strategy = (s: State) => Decision;

const V = (s: State) => s.prize * finalChances(s.p, s.sched, s.done)[s.slot];

/** Applies a switch as Game.tsx does (refused when canSwitch says no). */
function relock(s: State, t: number | undefined): State {
  if (t === undefined || t === s.slot) return s;
  const q = finalChances(s.p, s.sched, s.done);
  const v = s.prize * q[s.slot];
  if (!canSwitch(v, q[t])) return s;
  return { ...s, slot: t, prize: v / q[t] };
}

/** Survival of the next step: share of next pairs that keep the cup alive, or the reveal's P(ball here). */
function survival(s: State): number {
  if (s.done >= MOVES) return s.p[s.slot];
  const odds = nextOdds(s.p, s.sched, s.done, s.slot);
  return odds.filter((x) => x > 0).length / odds.length;
}

function mostLikely(s: State): number {
  const q = finalChances(s.p, s.sched, s.done);
  let best = s.slot;
  for (let t = 0; t < q.length; t++) if (q[t] > q[best]) best = t;
  return best;
}

function longestShot(s: State): number {
  const q = finalChances(s.p, s.sched, s.done);
  const v = s.prize * q[s.slot];
  let best = s.slot;
  for (let t = 0; t < q.length; t++) if (canSwitch(v, q[t]) && q[t] < q[best]) best = t;
  return best;
}

const STRATEGIES: { name: string; play: Strategy }[] = [
  { name: '(a) on while ≥ 80% survive', play: (s) => (survival(s) >= 0.8 ? { cash: false } : { cash: true }) },
  { name: '(b) take any profit', play: (s) => (V(s) > 1 ? { cash: true } : { cash: false }) },
  { name: '(c) play to the reveal', play: () => ({ cash: false }) },
  { name: '(d1) switch to likeliest', play: (s) => ({ cash: false, slot: mostLikely(s) }) },
  { name: '(d2) switch to long shot', play: (s) => ({ cash: false, slot: longestShot(s) }) },
  { name: '(d3) Auto, 2× target', play: (s) => (V(s) >= 2 ? { cash: true } : { cash: false }) },
];

/**
 * Exact value of a strategy: enumerate every observable history (pairs; blind
 * coins are unseen and enter only through the posterior, which the first test
 * proves is exact). Mirrors Game.tsx: the first move is forced, V = 0 ends the
 * round, a certain win at the end reveals at once.
 */
function exactValue(setup: Setup, play: Strategy): number {
  const sched = schedule(setup.blinds);
  const go = (s: State): number => {
    if (s.done >= 1) {
      const q = finalChances(s.p, s.sched, s.done);
      const v = s.prize * q[s.slot];
      if (v === 0) return 0;
      if (s.done >= MOVES && q[s.slot] === 1) return s.prize;
      const d = play(s);
      if (d.cash) return v;
      s = relock(s, d.slot);
      if (s.done >= MOVES) return s.prize * s.p[s.slot];
    }
    const pairs = setup.cups - 1;
    let ev = 0;
    for (let a = 0; a < pairs; a++) ev += go({ ...s, p: applyMove(s.p, a, s.sched[s.done]), done: s.done + 1 }) / pairs;
    return ev;
  };
  const p = startBelief(setup.cups);
  return go({ sched, p, done: 0, slot: setup.slot, prize: RTP / finalChances(p, sched, 0)[setup.slot] });
}

/** One real round: drawMove for the dealer, the real ball, the real reveal. */
function playReal(setup: Setup, play: Strategy, rng: Rng): number {
  const sched = schedule(setup.blinds);
  let s: State = { sched, p: startBelief(setup.cups), done: 0, slot: setup.slot, prize: 0 };
  s.prize = RTP / finalChances(s.p, sched, 0)[s.slot];
  let ball = 0;
  for (;;) {
    const blind = sched[s.done];
    const { pair, swapped } = drawMove(rng, setup.cups, blind);
    ball = moveBall(ball, pair, swapped);
    s = { ...s, p: applyMove(s.p, pair, blind), done: s.done + 1 };
    const q = finalChances(s.p, sched, s.done);
    const v = s.prize * q[s.slot];
    if (v === 0) return 0;
    if (s.done >= MOVES && q[s.slot] === 1) return ball === s.slot ? s.prize : NaN; // a certain win must be real
    const d = play(s);
    if (d.cash) return v;
    s = relock(s, d.slot);
    if (s.done >= MOVES) return ball === s.slot ? s.prize : 0;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let sum2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    sum += x;
    sum2 += x * x;
    max = Math.max(max, x);
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, sum2 / rounds - mean * mean) / rounds), max };
}

const allSetups: Setup[] = CUPS.flatMap((cups) => BLINDS.flatMap((blinds) => Array.from({ length: cups }, (_, slot) => ({ cups, blinds, slot }))));

describe('Shells fairness', () => {
  it('the belief is the exact posterior of the real ball (every pair sequence, every blind coin)', () => {
    let nodes = 0;
    for (const cups of CUPS)
      for (const blinds of BLINDS) {
        const sched = schedule(blinds);
        // dist: the real ball's distribution given the pairs seen so far (coins summed out).
        const walk = (p: number[], dist: number[], done: number) => {
          nodes++;
          const mass = dist.reduce((a, x) => a + x, 0);
          for (let i = 0; i < cups; i++) expect(Math.abs(dist[i] / mass - p[i])).toBeLessThan(1e-12);
          if (done >= MOVES) return;
          const blind = sched[done];
          for (let a = 0; a < cups - 1; a++) {
            const next = Array.from({ length: cups }, () => 0);
            // Both halves of the coin's range, through the game's own drawMove.
            for (const coin of [0.25, 0.75]) {
              const { pair, swapped } = drawMove(scripted(a, coin), cups, blind);
              expect(pair).toBe(a);
              for (let b = 0; b < cups; b++) next[moveBall(b, pair, swapped)] += dist[b] / 2;
            }
            walk(applyMove(p, a, blind), next, done + 1);
          }
        };
        walk(startBelief(cups), startBelief(cups), 0);
      }
    expect(nodes).toBeGreaterThan(5000);
  });

  it('a blind coin swaps exactly half the time (rng.next() < ½ over the whole range)', () => {
    // u ∈ [0, ½) swaps, u ∈ [½, 1) does not: exactly ½ of a uniform draw.
    expect(drawMove(scripted(0, 0.5 - 2 ** -32), 3, true).swapped).toBe(true);
    expect(drawMove(scripted(0, 0.5), 3, true).swapped).toBe(false);
    expect(drawMove(scripted(0, 0.999), 3, false).swapped).toBe(true);
  });

  it('martingale: at 30+ reached states, every action (play on, or any allowed switch then play on) keeps V exactly', () => {
    const rng = createRng(seededSource(4401));
    const states: State[] = [];
    for (let r = 0; r < 60; r++) {
      const setup = allSetups[rng.int(allSetups.length)];
      const sched = schedule(setup.blinds);
      let s: State = { sched, p: startBelief(setup.cups), done: 0, slot: setup.slot, prize: 0 };
      s.prize = RTP / finalChances(s.p, sched, 0)[s.slot];
      const stopAt = rng.int(MOVES);
      while (s.done < stopAt) {
        const { pair } = drawMove(rng, setup.cups, sched[s.done]);
        s = { ...s, p: applyMove(s.p, pair, sched[s.done]), done: s.done + 1 };
        if (V(s) === 0) break;
        // Sometimes switch on the way (to reach relocked prizes near the cap).
        if (rng.next() < 0.4) s = relock(s, rng.int(setup.cups));
      }
      if (V(s) > 0) states.push(s);
    }
    // Near the end: one move left, every config.
    expect(states.length).toBeGreaterThanOrEqual(30);
    expect(states.some((s) => s.done === MOVES - 1)).toBe(true);
    let actions = 0;
    for (const s of states) {
      const v = V(s);
      for (let t = 0; t < s.p.length; t++) {
        const r = relock(s, t);
        if (t !== s.slot && r === s) continue; // switch refused by the cap: not an action
        // The relock itself keeps V.
        expect(Math.abs(V(r) - v)).toBeLessThan(1e-12 * Math.max(1, v));
        expect(r.prize).toBeLessThanOrEqual(Math.max(s.prize, MAX_WIN * (1 + 1e-12)));
        const pairs = s.p.length - 1;
        let ev = 0;
        for (let a = 0; a < pairs; a++) {
          const n: State = { ...r, p: applyMove(r.p, a, r.sched[r.done]), done: r.done + 1 };
          ev += V(n) / pairs;
        }
        expect(Math.abs(ev - v)).toBeLessThan(1e-12 * Math.max(1, v));
        actions++;
      }
    }
    expect(actions).toBeGreaterThan(states.length);
  });

  it('exact: every strategy on every cup count, blind count and starting cup is worth RTP', () => {
    for (const setup of allSetups) for (const { play } of STRATEGIES) expect(exactValue(setup, play)).toBeCloseTo(RTP, 10);
  });

  it('Monte Carlo with the real ball: (a)–(d) on every eval config are within 4 SE of RTP, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, play }, si) => {
        const { mean, se, max } = mc((rng) => playReal(params, play, rng), ROUNDS, 6100 + 37 * ci + si);
        rows.push(`${label.split(' ')[0].padEnd(8)} ${name.padEnd(28)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}`);
        expect(Number.isNaN(mean)).toBe(false);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
