// Fairness audit: no strategy can beat the RTP.
//
// The cash-out V = prize × P(held seed wins | results so far) must be a
// martingale under every action the player can take at a checkpoint (play the
// next match, skip to their own match, switch seeds, cash out), so by optional
// stopping every strategy returns exactly RTP. Each match has two outcomes, so
// both the one-step check and the strategy RTPs are computed by EXACT
// enumeration of the tournament tree with the game's own functions (nextMatch,
// outcomes, playMatch, titleOdds, switchPrize), not a re-implementation.
// A small Monte Carlo of the same strategies with the real RNG cross-checks
// the enumeration; the 200k-round runs live in the scratch audit script.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  FIELDS,
  MAX_PRIZE,
  PRESETS,
  RTP,
  beats,
  emptyResults,
  isAlive,
  makeBracket,
  nextMatch,
  outcomes,
  playMatch,
  players,
  prizeFor,
  switchPrize,
  titleOdds,
  withResult,
  type Bracket,
  type Field,
  type MatchRef,
  type Preset,
  type Results,
} from './math';

interface S {
  b: Bracket;
  res: Results;
  held: number;
  prize: number;
}

const value = (s: S) => s.prize * titleOdds(s.b, s.res)[s.held];

/** Chance the held seed survives the next match (1 when it isn't playing). */
function survival(s: S, ref: MatchRef): number {
  const [x, y] = players(s.b, s.res, ref.k, ref.m);
  if (x === s.held) return beats(s.b, x, y);
  if (y === s.held) return beats(s.b, y, x);
  return 1;
}

/** Applies a switch the way the game does (Game.tsx pickSeed): refused if switchPrize says null. */
function trySwitch(s: S, to: number): S {
  if (to === s.held) return s;
  const np = switchPrize(value(s), titleOdds(s.b, s.res)[to]);
  return np === null ? s : { ...s, held: to, prize: np };
}

/** A checkpoint decision: cash out, or (optionally switch, then) play the next match. */
type Decision = { cash: true } | { cash: false; to?: number };
type Strategy = (s: S, ref: MatchRef) => Decision;

const testers: Strategy = (s, ref) => ({ cash: survival(s, ref) < 0.8 });
const takeProfit: Strategy = (s) => ({ cash: value(s) > 1 });
const toTheEnd: Strategy = () => ({ cash: false });
/** Hop to the live seed most likely to survive its next match, then use the tester's rule. */
const hopper: Strategy = (s) => {
  const odds = titleOdds(s.b, s.res);
  let best = s;
  let bestSurv = -1;
  for (let t = 0; t < s.b.n; t++) {
    if (odds[t] === 0) continue;
    const c = trySwitch(s, t);
    if (c.held !== t) continue;
    const ref = nextMatch(c.b, c.res, c.held)!;
    const sv = survival(c, ref);
    if (sv > bestSurv) (bestSurv = sv), (best = c);
  }
  const ref = nextMatch(best.b, best.res, best.held)!;
  return survival(best, ref) < 0.8 ? { cash: true } : { cash: false, to: best.held };
};
/** Max variance: switch to the longest live shot the cap allows, cash out at 2× the stake. */
const longshot: Strategy = (s) => {
  if (value(s) >= 2) return { cash: true };
  const odds = titleOdds(s.b, s.res);
  let to = s.held;
  for (let t = 0; t < s.b.n; t++) {
    if (odds[t] === 0 || trySwitch(s, t).held !== t) continue;
    if (odds[t] < odds[to]) to = t;
  }
  return { cash: false, to };
};

const STRATEGIES: [string, Strategy][] = [
  ['(a) tester: play on only when survival ≥ 0.8', testers],
  ['(b) take any profit: cash out once V > bet', takeProfit],
  ['(c) play to the end', toTheEnd],
  ['(d1) hop to the seed safest in its next match', hopper],
  ['(d2) switch to the longest shot, cash at 2×', longshot],
];

/** Exact expected payout of a strategy from a fresh bet on `seed`, by enumerating every match result. */
function exactRtp(n: Field, preset: Preset, seed: number, strat: Strategy): number {
  const b = makeBracket(n, preset);
  // As in Game.tsx: Bet plays the first match at once; checkpoints come after each match.
  const play = (s: S): number => {
    const ref = nextMatch(s.b, s.res, s.held)!;
    const [x, y] = outcomes(s.b, s.res, ref, s.held);
    let ev = 0;
    for (const o of [x, y]) {
      if (o.p === 0) continue;
      ev += o.p * visit({ ...s, res: withResult(s.res, ref, o.winner) });
    }
    return ev;
  };
  const visit = (s: S): number => {
    if (!isAlive(s.b, s.res, s.held)) return 0;
    const ref = nextMatch(s.b, s.res, s.held);
    if (!ref) return s.prize;
    const d = strat(s, ref);
    if (d.cash) return value(s);
    return play(d.to === undefined ? s : trySwitch(s, d.to));
  };
  return play({ b, res: emptyResults(b), held: seed, prize: prizeFor(n, preset, seed) });
}

/** One simulated round of a strategy with the real RNG, mirroring Game.tsx step(). */
function simulate(n: Field, preset: Preset, seed: number, strat: Strategy, rng: ReturnType<typeof createRng>): number {
  const b = makeBracket(n, preset);
  let s: S = { b, res: emptyResults(b), held: seed, prize: prizeFor(n, preset, seed) };
  for (;;) {
    const ref = nextMatch(b, s.res, s.held)!;
    s = { ...s, res: withResult(s.res, ref, playMatch(b, s.res, ref, rng.next())) };
    if (titleOdds(b, s.res)[s.held] === 0) return 0;
    const next = nextMatch(b, s.res, s.held);
    if (!next) return s.prize;
    const d = strat(s, next);
    if (d.cash) return value(s);
    if (d.to !== undefined) s = trySwitch(s, d.to);
  }
}

const CONFIGS = evalSpec.configs.map((c) => c.params);
/** FAIRNESS_FULL=1 runs every seed exactly and 200k-round Monte Carlo (minutes, not seconds). */
const FULL = !!import.meta.env.FAIRNESS_FULL;
const log = (line: string) => FULL && console.log(line);

describe('Bracket fairness', () => {
  it('martingale: at ≥ 30 varied states, every action keeps E[V after the next match] = V', () => {
    const rng = createRng(seededSource(101));
    let checked = 0;
    let bigPrize = 0;
    for (const n of FIELDS) {
      for (const preset of PRESETS) {
        for (let trial = 0; trial < 12; trial++) {
          const b = makeBracket(n, preset);
          const seed = rng.int(n);
          let s: S = { b, res: emptyResults(b), held: seed, prize: prizeFor(n, preset, seed) };
          // Play to a random depth (including the last match before the final whistle).
          const depth = trial < 3 ? n - 2 : rng.int(n - 1);
          for (let i = 0; i < depth; i++) {
            const ref = nextMatch(b, s.res, s.held);
            if (!ref) break;
            s = { ...s, res: withResult(s.res, ref, playMatch(b, s.res, ref, rng.next())) };
          }
          if (!isAlive(b, s.res, s.held) || !nextMatch(b, s.res, s.held)) continue;
          const v = value(s);
          const odds = titleOdds(b, s.res);
          // Every action: stay, or switch to each live seed the game allows.
          for (let t = 0; t < n; t++) {
            if (odds[t] === 0) continue;
            const c = trySwitch(s, t);
            if (c.held !== t) {
              // A refused switch only happens because the new prize would pass the cap.
              expect(v / odds[t]).toBeGreaterThan(MAX_PRIZE);
              continue;
            }
            // The switch itself keeps V.
            expect(value(c)).toBeCloseTo(v, 9);
            const ref = nextMatch(b, c.res, c.held)!;
            const [x, y] = outcomes(b, c.res, ref, c.held);
            expect(x.after).toBe(titleOdds(b, withResult(c.res, ref, x.winner))[c.held]);
            const ev = x.p * c.prize * x.after + y.p * c.prize * y.after;
            expect(Math.abs(ev - v)).toBeLessThan(1e-9 * Math.max(1, v));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);

    // Directed states near the end and at the largest prizes: back the 16th
    // seed in the Steep field, let it (and every other underdog) win, and hop
    // to the longest live shot after every match. The prize climbs to ~1,427×
    // and V to ~1,427 by the final; every action must still be fair there.
    const b = makeBracket(16, 'steep');
    let s: S = { b, res: emptyResults(b), held: 15, prize: prizeFor(16, 'steep', 15) };
    for (;;) {
      const ref = nextMatch(b, s.res, s.held);
      if (!ref) break;
      const [x, y] = players(b, s.res, ref.k, ref.m);
      const w = x === s.held || y === s.held ? s.held : b.ratings[x] < b.ratings[y] ? x : y;
      s = { ...s, res: withResult(s.res, ref, w) };
      if (!nextMatch(b, s.res, s.held)) break;
      const v = value(s);
      const odds = titleOdds(b, s.res);
      let to = s.held;
      for (let t = 0; t < 16; t++) {
        if (odds[t] === 0) continue;
        const c = trySwitch(s, t);
        if (c.held !== t) {
          expect(v / odds[t]).toBeGreaterThan(MAX_PRIZE);
          continue;
        }
        bigPrize = Math.max(bigPrize, c.prize);
        const r2 = nextMatch(b, c.res, c.held)!;
        const [ox, oy] = outcomes(b, c.res, r2, c.held);
        expect(Math.abs(ox.p * c.prize * ox.after + oy.p * c.prize * oy.after - v)).toBeLessThan(1e-9 * Math.max(1, v));
        if (odds[t] < odds[to]) to = t;
        checked++;
      }
      s = trySwitch(s, to);
    }
    expect(bigPrize).toBeGreaterThan(1_000);
  });

  it('the match drawn is the match shown: u < P(first seed wins) ⇔ first seed wins', () => {
    for (const n of FIELDS) {
      for (const preset of PRESETS) {
        const b = makeBracket(n, preset);
        const res = emptyResults(b);
        for (let m = 0; m < n / 2; m++) {
          const ref = { k: 0, m };
          const [x, y] = players(b, res, 0, m);
          const p = beats(b, x, y);
          expect(outcomes(b, res, ref, x)[0].p).toBe(p);
          expect(playMatch(b, res, ref, 0)).toBe(x);
          expect(playMatch(b, res, ref, Math.max(0, p - 1e-12))).toBe(x);
          expect(playMatch(b, res, ref, p)).toBe(y);
          expect(playMatch(b, res, ref, 1 - 2 ** -32)).toBe(y);
        }
      }
    }
  });

  it('adversarial strategies return exactly RTP (exact enumeration of the match tree)', () => {
    for (const cfg of CONFIGS) {
      for (const [name, strat] of STRATEGIES) {
        // 16-seed trees are 2^15 leaves at ~35 µs per DP: the quick run spot-checks
        // one seed with the cheap strategies; FAIRNESS_FULL=1 runs everything.
        if (cfg.n === 16 && !FULL && strat !== testers && strat !== takeProfit) continue;
        const seeds = cfg.n === 16 && !FULL ? [cfg.seeds[0]] : cfg.seeds;
        let sum = 0;
        for (const seed of seeds) {
          const r = exactRtp(cfg.n, cfg.preset, seed - 1, strat);
          sum += r;
          expect(Math.abs(r - RTP), `${name}, seed ${seed}: ${r}`).toBeLessThan(1e-9);
        }
        log(`exact ${cfg.n}/${cfg.preset} seeds ${seeds.join(',')} | ${name} | RTP ${((sum / seeds.length) * 100).toFixed(9)}%`);
      }
    }
  });

  it('Monte Carlo of the same strategies with the real RNG agrees (4 SE)', () => {
    const rng = createRng(seededSource(202));
    for (const cfg of CONFIGS) {
      if (cfg.n === 16 && !FULL) continue;
      const rounds = FULL ? (cfg.n === 8 ? 200_000 : 50_000) : 2_000;
      for (const [name, strat] of STRATEGIES) {
        // The switching strategies re-run the DP for every seed each match; the
        // quick run leaves them to the exact enumeration above.
        if (!FULL && (strat === hopper || strat === longshot)) continue;
        let sum = 0;
        let sq = 0;
        for (let r = 0; r < rounds; r++) {
          const x = simulate(cfg.n, cfg.preset, cfg.seeds[rng.int(cfg.seeds.length)] - 1, strat, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / rounds;
        const se = Math.sqrt(Math.max(0, sq / rounds - mean * mean) / rounds);
        log(`MC ${cfg.n}/${cfg.preset} | ${name} | ${rounds} rounds | RTP ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP), `${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  });
});
