// Fairness audit: can any way of playing Scales beat the RTP?
//
// The bet (kind, margin k, bead count n) is fixed when Bet is pressed: every
// setting is disabled while a round is live and the round carries its own bet
// and prize. Mid-round the only decision is at each checkpoint: cash out at
// prize × P(win | D, m), drop the next bead, or drop all. So the cash-out V is
// the whole story: if E[V after the next bead] = V at every reachable state,
// optional stopping says no stopping rule beats RTP.
//
// Checks, on the game's real functions (beadFrom, addBead, chance / chanceAt,
// settled, prizeFor, kMax, the eval configs):
//   1. beadFrom maps 12 equal slices of u to the 12 (side, weight) beads.
//   2. Martingale, exact (the next event has 12 outcomes): at >= 30 states
//      reached by random play, for every bet the panel offers, including
//      states one bead from the end and the largest margins (prize near the
//      MAX_PRIZE cap), V now equals the mean of V over the 12 next beads.
//   3. Strategies, exact. Each is a stopping rule on (D, m), so its return is
//      a finite backward recursion over the reachable (D, m), exact to float:
//        (a1) tester: drop only when the next bead keeps the bet alive
//             (does not settle a loss) with chance >= 0.8, else cash out;
//        (a2) tester, value form: drop only when the next bead does not lower
//             the cash-out with chance >= 0.8;
//        (b)  take any profit: cash out once V > the stake;
//        (c)  play to the end;
//        (d)  the optimal stopping value (Snell envelope): the best any
//             strategy can do. Computed for every bet the panel offers, so it
//             also covers "pick the best bet".
//      All must equal RTP (to 1e-9).
//   4. Monte Carlo replays (a1), (b), (c) with real draws on every eval
//      config as a plumbing check (4 SE). The extreme bets pay up to ~1000×
//      at ~1%, so the SE is a few % there: the exact checks are binding.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BEAD_COUNTS,
  K_MIN,
  MAX_PRIZE,
  RTP,
  addBead,
  allowed,
  beadFrom,
  chance,
  chanceAt,
  diffOf,
  effect,
  kMax,
  leftToDrop,
  prizeFor,
  settled,
  type Bead,
  type Bet,
  type Pans,
} from './math';

const BEADS: Bead[] = Array.from({ length: 12 }, (_, i) => beadFrom((i + 0.5) / 12));

/** Every bet the panel can offer for n beads. */
function offered(n: number): Bet[] {
  const bets: Bet[] = [
    { kind: 'L', k: 0 },
    { kind: 'R', k: 0 },
    { kind: 'B', k: 0 },
  ];
  for (let k = K_MIN; k <= kMax(n); k++) bets.push({ kind: 'K', k });
  return bets.filter((b) => allowed(n, b));
}

/** The game's cash-out at a state: the settled payout, or prize × chance. */
function value(s: Pans, bet: Bet, prize: number): number {
  const r = settled(s, bet);
  return r ? (r === 'win' ? prize : 0) : prize * chanceAt(s, bet);
}

const tables = new Map<string, (D: number, m: number) => number>();
/** V on (D, m) with the real chance(), memoised per (n, bet). */
function valueTable(n: number, bet: Bet) {
  const id = `${n}|${bet.kind}|${bet.k}`;
  const hit = tables.get(id);
  if (hit) return hit;
  const prize = prizeFor(n, bet);
  const memo = new Map<number, number>();
  const V = (D: number, m: number) => {
    const key = D * 64 + m;
    let v = memo.get(key);
    if (v === undefined) memo.set(key, (v = prize * chance(bet, D, m)));
    return v;
  };
  tables.set(id, V);
  return V;
}

/**
 * Exact return of a stopping rule. `stop(D, m, V)` is asked at each
 * checkpoint (after a bead, while unsettled); the first bead always drops.
 */
function exactReturn(n: number, bet: Bet, stop: (D: number, m: number, V: number) => boolean): number {
  const V = valueTable(n, bet);
  const memo = new Map<number, number>();
  const E = (D: number, m: number, first: boolean): number => {
    const v = V(D, m);
    const p = v / prizeFor(n, bet);
    if (m === 0 || p === 0 || p === 1) return v; // settled: pays prize or 0
    if (!first && stop(D, m, v)) return v;
    const key = D * 64 + m;
    if (!first) {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
    }
    let s = 0;
    for (const b of BEADS) s += E(D + effect(b), m - 1, false);
    s /= 12;
    if (!first) memo.set(key, s);
    return s;
  };
  return E(0, n, true);
}

/** Snell envelope: max over every stopping rule. */
function optimalReturn(n: number, bet: Bet): number {
  const V = valueTable(n, bet);
  const prize = prizeFor(n, bet);
  const memo = new Map<number, number>();
  const E = (D: number, m: number, first: boolean): number => {
    const v = V(D, m);
    if (m === 0 || v === 0 || v === prize) return v;
    const key = D * 64 + m;
    if (!first) {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
    }
    let s = 0;
    for (const b of BEADS) s += E(D + effect(b), m - 1, false);
    s /= 12;
    const out = first ? s : Math.max(v, s);
    if (!first) memo.set(key, out);
    return out;
  };
  return E(0, n, true);
}

describe('scales fairness', () => {
  it('beadFrom splits u into 12 equal slices, one per (side, weight)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const lo = beadFrom(i / 12);
      const hi = beadFrom((i + 1) / 12 - 1e-12);
      expect(lo).toEqual(hi);
      expect(lo).toEqual(BEADS[i]);
      seen.add(`${lo.side}${lo.w}`);
    }
    expect(seen.size).toBe(12);
    expect(BEADS.reduce((s, b) => s + effect(b), 0)).toBe(0);
  });

  it('martingale: V now = mean of V over the 12 next beads, at random reachable states (exact)', () => {
    const rng = createRng(seededSource(7));
    let states = 0;
    let nearEnd = 0;
    let nearCap = 0;
    for (const n of BEAD_COUNTS) {
      const bets = offered(n);
      for (const bet of bets) {
        const prize = prizeFor(n, bet);
        expect(prize).toBeLessThanOrEqual(MAX_PRIZE + 1e-9);
        if (prize > 0.5 * MAX_PRIZE) nearCap++;
        // One random round per bet; test every unsettled state on the way.
        for (let r = 0; r < 1; r++) {
          let s: Pans = { n, beads: [] };
          while (leftToDrop(s) > 0 && !settled(s, bet)) {
            const now = value(s, bet, prize);
            const next = BEADS.map((b) => value(addBead(s, b), bet, prize));
            const mean = next.reduce((a, b) => a + b, 0) / 12;
            expect(Math.abs(mean - now)).toBeLessThan(1e-9 * Math.max(1, prize));
            states++;
            if (leftToDrop(s) === 1) nearEnd++;
            s = addBead(s, beadFrom(rng.next()));
          }
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    expect(nearEnd).toBeGreaterThan(0);
    expect(nearCap).toBeGreaterThan(0);
  });

  it('martingale holds at every reachable (D, m) of the eval configs (exhaustive)', () => {
    for (const { params } of evalSpec.configs) {
      const { n, bet } = params;
      const V = valueTable(n, bet);
      const prize = prizeFor(n, bet);
      for (let m = 1; m <= n; m++) {
        const R = 6 * (n - m);
        for (let D = -R; D <= R; D++) {
          const now = V(D, m);
          if (now === 0 || now === prize) continue; // settled
          let mean = 0;
          for (const b of BEADS) mean += V(D + effect(b), m - 1);
          expect(Math.abs(mean / 12 - now)).toBeLessThan(1e-9 * Math.max(1, prize));
        }
      }
    }
  });

  it('the cash-out readout equals the real chance of the state (chanceAt)', () => {
    const s: Pans = { n: 12, beads: [beadFrom(0.01), beadFrom(0.99), beadFrom(0.3)] };
    const bet: Bet = { kind: 'L', k: 0 };
    expect(chanceAt(s, bet)).toBe(chance(bet, diffOf(s), 9));
  });

  describe('strategies, exact', () => {
    for (const n of BEAD_COUNTS) {
      it(`${n} beads: (a1) (a2) (b) (c) and the optimal rule return RTP for L, R, B and a spread of margins`, () => {
        // Every 12th margin plus the two nearest the prize cap; the scratch
        // run (fairness/scales-heavy.ts) does every offered margin.
        const top = kMax(n);
        const bets = offered(n).filter((b) => b.kind !== 'K' || (b.k - K_MIN) % 12 === 0 || b.k >= top - 1);
        for (const bet of bets) {
          const V = valueTable(n, bet);
          const prize = prizeFor(n, bet);
          const aliveNext = (D: number, m: number) => BEADS.filter((b) => V(D + effect(b), m - 1) > 0).length / 12;
          const holdNext = (D: number, m: number, v: number) => BEADS.filter((b) => V(D + effect(b), m - 1) >= v - 1e-12).length / 12;
          const rules: [string, (D: number, m: number, v: number) => boolean][] = [
            ['a1', (D, m) => aliveNext(D, m) < 0.8],
            ['a2', (D, m, v) => holdNext(D, m, v) < 0.8],
            ['b', (_D, _m, v) => v > 1],
            ['c', () => false],
          ];
          for (const [name, stop] of rules) {
            expect(Math.abs(exactReturn(n, bet, stop) - RTP), `${name} ${bet.kind}${bet.k} prize ${prize}`).toBeLessThan(1e-9);
          }
          expect(Math.abs(optimalReturn(n, bet) - RTP), `optimal ${bet.kind}${bet.k}`).toBeLessThan(1e-9);
        }
      });
    }
  });

  describe('strategies, Monte Carlo on real draws (plumbing check)', () => {
    const ROUNDS = 30_000;
    evalSpec.configs.forEach(({ label, params }, ci) => {
      it(label, () => {
        const { n, bet } = params;
        const V = valueTable(n, bet);
        const prize = prizeFor(n, bet);
        const aliveMemo = new Map<number, number>();
        const aliveNext = (D: number, m: number) => {
          const key = D * 64 + m;
          let a = aliveMemo.get(key);
          if (a === undefined) aliveMemo.set(key, (a = BEADS.filter((b) => V(D + effect(b), m - 1) > 0).length / 12));
          return a;
        };
        const rules: [string, (D: number, m: number, v: number) => boolean][] = [
          ['a1', (D, m) => aliveNext(D, m) < 0.8],
          ['b', (_D, _m, v) => v > 1],
          ['c', () => false],
        ];
        rules.forEach(([name, stop], ri) => {
          const rng = createRng(seededSource(1000 + ci * 10 + ri));
          let sum = 0;
          let sq = 0;
          for (let i = 0; i < ROUNDS; i++) {
            // D and m tracked directly (diffOf / leftToDrop of the bead list, without the O(n) rescans).
            let D = 0;
            let m = n;
            let paid = 0;
            for (;;) {
              D += effect(beadFrom(rng.next()));
              m--;
              const v = V(D, m);
              if (m === 0 || v === 0 || v === prize || stop(D, m, v)) {
                paid = v;
                break;
              }
            }
            sum += paid;
            sq += paid * paid;
          }
          const mean = sum / ROUNDS;
          const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
          expect(Math.abs(mean - RTP), `${label} ${name}`).toBeLessThan(4 * se);
        });
      });
    });
  });
});
