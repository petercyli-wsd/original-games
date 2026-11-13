// Fairness audit: can any way of playing Burrows beat the RTP?
//
// Every tap hides the m critters afresh (hide: a uniform m-subset, the first m
// of one shuffle), looks in the tapped burrow, and a find multiplies the
// cash-out by 7/m. The draw happens only after ticket.place() resolved, one per
// tap, so the state never holds a future outcome; the critter count is locked
// while a round is live; Random burrow and keys 1 to 7 call the same tap(); and
// Auto climbs a planned burrow list with autoClimb. Cash out is disabled while a
// tap animates, and the ticket's fair value is a ref set in the tap handler.
//
// The claim "tap only when the next tap is >= 80% safe" fails exactly when, at
// every reachable state and for every burrow b,
//
//     P(b holds a critter | history) · V(n + 1) = V(n).
//
// The martingale check computes that probability exactly by running the real
// hide on every one of the 5040 orders the shuffle could return, for every
// burrow, at every n below the cap of every setting (211 states, far more than
// 30). Taps are independent draws, so the history can't change it. The Monte
// Carlo section then plays hostile strategies on every eval config with the
// host shuffle, each within 4 SE of RTP, and every strategy that stops on n only
// is also valued exactly by backward induction.
//
// Strategies:
//   (a) the tester's: tap only while the next tap is >= 80% safe, else cash out
//       (6 critters is the only such setting; the others cash out after the
//       mandatory first find);
//   (b) take any profit: cash out the moment the cash-out exceeds the stake;
//   (c) play to the cap;
//   (d) the strongest: hot burrow (cycle the burrows), cash out at >= 3x, switch the critter count between rounds,
//       and every Auto plan to k finds.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BURROWS, CRITTERS, MAX_MULTIPLIER, RTP, autoClimb, findChance, hide, maxFinds, playRound, reachChance, value } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}
const PERMS = permutations(BURROWS);

type Stop = (m: number, n: number) => boolean;

/** Exact value of a stop-on-n rule: n = 0 is mandatory, the cap auto-cashes. */
function exactValue(m: number, stop: Stop): number {
  const p = findChance(m);
  const cap = maxFinds(m);
  let v = value(m, cap);
  for (let n = cap - 1; n >= 0; n--) v = n > 0 && stop(m, n) ? value(m, n) : p * v;
  return v;
}

describe('Burrows fairness', () => {
  it('martingale (exact): P(burrow holds a critter) · V(n+1) = V(n) for every burrow, real hide on every shuffle order, 211 states', () => {
    let states = 0;
    for (const m of CRITTERS) {
      const per = new Array<number>(BURROWS).fill(0);
      for (const p of PERMS) hide(m, <T,>(xs: readonly T[]) => p.map((i) => xs[i])).forEach((h, b) => h && per[b]++);
      for (let n = 0; n < maxFinds(m); n++) {
        for (let b = 0; b < BURROWS; b++) expect(((per[b] / PERMS.length) * value(m, n + 1)) / value(m, n)).toBeCloseTo(1, 12);
        states++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the cap is a stopping rule: the last state auto-cashes at V(cap) <= MAX_WIN and never offers a find above it', () => {
    for (const m of CRITTERS) expect(value(m, maxFinds(m))).toBeLessThanOrEqual(MAX_MULTIPLIER * (1 + 1e-12));
  });

  const tester: Stop = (m) => findChance(m) < 0.8;
  const profit: Stop = (m, n) => value(m, n) > 1;
  const toCap: Stop = () => false;
  const hotStop: Stop = (m, n) => value(m, n) >= 3;

  it('every n-only strategy is worth exactly RTP (backward induction) at every setting', () => {
    for (const m of CRITTERS) for (const s of [tester, profit, toCap, hotStop]) expect(exactValue(m, s)).toBeCloseTo(RTP, 10);
    for (const m of CRITTERS) for (let k = 1; k <= maxFinds(m); k++) expect(exactValue(m, (_m, n) => n >= k)).toBeCloseTo(RTP, 10);
  });

  it('Auto is the same maths as manual: autoClimb pays what tapping the same burrows by hand pays', () => {
    const rng = createRng(seededSource(5));
    const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);
    for (let i = 0; i < 3000; i++) {
      const m = CRITTERS[rng.int(6)];
      const k = 1 + rng.int(Math.min(10, maxFinds(m)));
      const picks = Array.from({ length: k }, () => rng.int(7));
      const a = autoClimb(m, picks, shuffle);
      const b = playRound(m, shuffle, (n) => picks[n], (n) => n >= k);
      expect(a.multiplier === 0).toBe(a.taps.some((t) => !t.hit));
      expect(a.finds <= k && b.finds <= k).toBe(true);
      expect(a.multiplier === 0 || a.multiplier === value(m, k)).toBe(true);
    }
  });

  it('strategies (a)-(d) on every eval config return RTP within 4 SE on the real draw, never above the max', () => {
    const rows: string[] = [];
    const run = (label: string, play: (rng: Rng) => number, seed: number, reach: number) => {
      const rng = createRng(seededSource(seed));
      let s = 0;
      let s2 = 0;
      let max = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const x = play(rng);
        s += x;
        s2 += x * x;
        max = Math.max(max, x);
      }
      const mean = s / ROUNDS;
      const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
      // A top prize that is reached in fewer than 1 of 200 rounds' worth of samples can't be measured by sampling: exact value only.
      const measurable = reach * ROUNDS >= 200;
      rows.push(`${label.padEnd(52)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / (se || 1)).toFixed(2)}${measurable ? '' : '  (exact only)'}`);
      if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows[rows.length - 1]);
      if (measurable) expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER * (1 + 1e-12));
    };
    // Each critter count is run on its own, so a rare top prize in one setting can't hide in another's noise.
    const shuffle = (rng: Rng) => <T,>(xs: readonly T[]) => rng.shuffle(xs);
    const randomBurrow = (rng: Rng) => () => rng.int(BURROWS);
    const reachStop = (m: number, s: Stop) => {
      let r = 1;
      for (let n = 0; n < maxFinds(m); n++) {
        r *= findChance(m);
        if (n > 0 && s(m, n)) break;
      }
      return r;
    };
    /** The random-stop strategy plays at most to the find count that is still reached 1 time in 300. */
    const tail = (m: number) => {
      let k = 1;
      while (k < maxFinds(m) && reachChance(m, k + 1) >= 1 / 300) k++;
      return k;
    };
    let seed = 0;
    evalSpec.configs.forEach((cfg) => {
      for (const m of (cfg.params as { band: number[] }).band) {
        const label = `${cfg.label.split(' ')[0]} m=${m}`;
        seed += 10;
        run(`(a) tap only when >= 80% safe · ${label}`, (rng) => playRound(m, shuffle(rng), randomBurrow(rng), (n) => tester(m, n)).multiplier, seed + 1, reachStop(m, tester));
        run(`(b) any profit · ${label}`, (rng) => playRound(m, shuffle(rng), randomBurrow(rng), (n) => profit(m, n)).multiplier, seed + 2, reachStop(m, profit));
        run(`(c) play to the cap · ${label}`, (rng) => playRound(m, shuffle(rng), randomBurrow(rng), (n) => toCap(m, n)).multiplier, seed + 3, reachChance(m, maxFinds(m)));
        run(`(d) hot burrow, cash at >= 3x · ${label}`, (rng) => playRound(m, shuffle(rng), (n) => n % BURROWS, (n) => hotStop(m, n)).multiplier, seed + 4, reachStop(m, hotStop));
        run(
          `(d) random stop · ${label}`,
          (rng) => {
            const q = 0.1 + 0.6 * rng.next();
            return playRound(m, shuffle(rng), randomBurrow(rng), (n) => n >= tail(m) || rng.next() < q).multiplier;
          },
          seed + 5,
          reachChance(m, tail(m)),
        );
        run(`(d) auto plan to 3 finds · ${label}`, (rng) => autoClimb(m, [rng.int(7), rng.int(7), rng.int(7)], shuffle(rng)).multiplier, seed + 6, reachChance(m, 3));
      }
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
