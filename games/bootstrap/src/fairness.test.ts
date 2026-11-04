// Fairness audit: can any way of playing Bootstrap beat the RTP?
//
// Seeds land uniformly on the non-seed cells and the infection closes after
// each. The cash-out is prize × P(win | C, a) with P computed exactly (integer
// sequence counts), and the round auto-settles at prize × P the moment P is 0
// or 1, so the value is a bounded martingale starting at RTP; by optional
// stopping every rule returns RTP.
//
// Decisions mid-round: only cash out or drop the next seed (side, grid and
// seed count are locked while live). Space and the button both call
// drop(round); there is no auto mode. Which healthy cell a seed hits is not
// the player's choice. The future depends only on (infected set C, seeds a):
// the non-seed cells inside C are |C| − a whatever the seeds' positions. So
// every strategy is a stopping rule on that chain.
//
// Checks, with the game's own functions (nextSeed, addSeed, pFull, pWin,
// cashOut, prizeFor) and Game.tsx's settlement (p = 1 pays the prize, p = 0 or
// the last seed ends the round at the cash value):
//   - nextSeed(u) is uniform over the non-seed cells on the RNG's 2^-32 grid;
//   - martingale: at 40+ states reached by random play on all 22 settings,
//     E[V after the next seed] = V now, exactly (1e-12), every cell enumerated;
//   - optimal stopping: the Snell envelope over every reachable (C, a) equals
//     V, so no strategy beats RTP;
//   - strategies (a)–(d) exactly (forward DP over (C, a)), and by Monte Carlo
//     through nextSeed / addSeed on every eval config.
// The two whole-chain checks run on every 4×4 setting and the 5×5 eval configs
// here; the heavy run (FAIRNESS_ROUNDS set) runs them on all 22 settings.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, addSeed, allMask, allSettings, cashOut, closure, nextSeed, pWin, popcount, prizeFor, type Settings, type State } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy-*.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 3_000);

const SETTINGS = allSettings();
const EVAL = evalSpec.configs.map((c) => c.params);
/**
 * Settings for the exact whole-chain checks: every 4×4 setting plus the 5×5
 * eval configs (keeps the file at a few seconds). The heavy run
 * (FAIRNESS_ROUNDS set) covers all 22.
 */
const EXACT = import.meta.env.FAIRNESS_ROUNDS
  ? SETTINGS
  : [...SETTINGS.filter((s) => s.n === 4), ...EVAL.filter((s) => s.n === 5)];

/** Per-setting memo tables (the reachable (C, a) chain has up to ~30k states). */
const memos = new WeakMap<Settings, { settle: Map<number, Settled>; survival: Map<number, number> }>();
const memo = (s: Settings) => {
  let m = memos.get(s);
  if (!m) memos.set(s, (m = { settle: new Map(), survival: new Map() }));
  return m;
};
interface Settled {
  over: boolean;
  value: number;
}

/** Game.tsx's drop(): the value after a seed takes the set to C with a seeds down, and whether that ends the round. */
function settle(s: Settings, C: number, a: number): Settled {
  const m = memo(s).settle;
  const id = C * 16 + a;
  let r = m.get(id);
  if (!r) {
    const p = pWin(s.side, C, a, s.n, s.k);
    const value = p === 1 ? prizeFor(s) : cashOut(s, C, a);
    m.set(id, (r = { over: p === 0 || p === 1 || a === s.k || C === allMask(s.n), value }));
  }
  return r;
}

/** cl(C ∪ {i}) for each healthy cell i, cached by grid and set. */
const kidCache: Record<number, Map<number, number[]>> = { 4: new Map(), 5: new Map() };
function kids(n: number, C: number): number[] {
  let out = kidCache[n].get(C);
  if (!out) {
    out = [];
    for (let i = 0; i < n * n; i++) if (!(C & (1 << i))) out.push(closure(C | (1 << i), n));
    kidCache[n].set(C, out);
  }
  return out;
}

/** Next states from (C, a): each healthy cell, plus the |C| − a wasted non-seed cells inside C. */
function successors(s: Settings, C: number, a: number): { C: number; w: number }[] {
  const N = s.n * s.n;
  const out: { C: number; w: number }[] = [];
  const wasted = popcount(C) - a;
  if (wasted > 0) out.push({ C, w: wasted / (N - a) });
  for (const X of kids(s.n, C)) out.push({ C: X, w: 1 / (N - a) });
  return out;
}

/** P(the next seed doesn't end the round lost). */
function survival(s: Settings, C: number, a: number): number {
  const m = memo(s).survival;
  const id = C * 16 + a;
  let p = m.get(id);
  if (p === undefined) {
    p = 0;
    for (const nx of successors(s, C, a)) if (pWin(s.side, nx.C, a + 1, s.n, s.k) > 0) p += nx.w;
    m.set(id, p);
  }
  return p;
}

/** A stopping rule at a checkpoint (C, a): true = cash out. */
type Stop = (s: Settings, C: number, a: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop while survival ≥ 0.8', stop: (s, C, a) => survival(s, C, a) < 0.8 },
  { name: '(b) take any profit', stop: (s, C, a) => cashOut(s, C, a) > 1 },
  { name: '(c) drop every seed', stop: () => false },
  // Ride the swings: cash out when ahead by 50% or when behind by half, and
  // also when the next seed is a coin flip or worse to keep the round alive.
  { name: '(d) take 1.5×, stop at 0.5×, or survival ≤ 50%', stop: (s, C, a) => cashOut(s, C, a) >= 1.5 || cashOut(s, C, a) <= 0.5 || survival(s, C, a) <= 0.5 },
];

/** Exact expected payout of a stopping rule: forward DP over (C, a). */
function exactValue(s: Settings, stop: Stop): number {
  let level = new Map<number, number>([[0, 1]]);
  let ev = 0;
  for (let a = 0; a < s.k; a++) {
    const next = new Map<number, number>();
    for (const [C, m] of level) {
      // Bet drops the first seed straight away: no decision at a = 0.
      if (a > 0 && stop(s, C, a)) {
        ev += m * cashOut(s, C, a);
        continue;
      }
      for (const nx of successors(s, C, a)) {
        const r = settle(s, nx.C, a + 1);
        if (r.over) ev += m * nx.w * r.value;
        else next.set(nx.C, (next.get(nx.C) ?? 0) + m * nx.w);
      }
    }
    level = next;
  }
  expect(level.size).toBe(0);
  return ev;
}

/** One round through nextSeed / addSeed, as Game.tsx plays it. */
function playRound(s: Settings, stop: Stop, rng: Rng): number {
  let st: State = { seeds: [], C: 0 };
  for (;;) {
    const a = st.seeds.length;
    if (a > 0 && stop(s, st.C, a)) return cashOut(s, st.C, a);
    st = addSeed(st, nextSeed(st, s.n, rng.next()), s.n);
    const r = settle(s, st.C, st.seeds.length);
    if (r.over) return r.value;
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

describe('Bootstrap fairness', () => {
  it('nextSeed is uniform over the non-seed cells on the RNG grid', () => {
    const rng = createRng(seededSource(3));
    for (let t = 0; t < 30; t++) {
      const n = rng.next() < 0.5 ? 4 : 5;
      let st: State = { seeds: [], C: 0 };
      const a = rng.int(n * n - 1);
      while (st.seeds.length < a) st = addSeed(st, nextSeed(st, n, rng.next()), n);
      const free = n * n - a;
      // u = j / 2^32 picks free cell floor(u · free): count the u's mapping to each cell.
      const counts = Array.from({ length: free }, (_, i) => Math.ceil(((i + 1) * 2 ** 32) / free) - Math.ceil((i * 2 ** 32) / free));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      const seen = new Set<number>();
      for (let i = 0; i < free; i++) seen.add(nextSeed(st, n, (i + 0.5) / free));
      expect(seen.size).toBe(free);
      for (const c of seen) expect(st.seeds.includes(c)).toBe(false);
      expect(nextSeed(st, n, 1 - 2 ** -32)).toBe([...seen].at(-1));
    }
  });

  it('martingale: at 40+ reached states on all 22 settings, E[V after the next seed] = V now', () => {
    const rng = createRng(seededSource(17));
    const settings = SETTINGS;
    let states = 0;
    let worst = 0;
    for (let t = 0; states < 44; t++) {
      const s = settings[t % settings.length];
      expect(cashOut(s, 0, 0)).toBeCloseTo(RTP, 12);
      let st: State = { seeds: [], C: 0 };
      // Play a random round and test every checkpoint it reaches (late ones included).
      for (;;) {
        st = addSeed(st, nextSeed(st, s.n, rng.next()), s.n);
        const a = st.seeds.length;
        if (settle(s, st.C, a).over) break;
        const v = cashOut(s, st.C, a);
        let ev = 0;
        for (const nx of successors(s, st.C, a)) ev += nx.w * settle(s, nx.C, a + 1).value;
        worst = Math.max(worst, Math.abs(ev - v) / prizeFor(s));
        states++;
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('optimal stopping: the Snell envelope over every reachable (C, a) equals V', () => {
    for (const s of EXACT) {
      // Reachable checkpoint sets per level.
      const levels: Set<number>[] = [new Set([0])];
      for (let a = 0; a < s.k; a++) {
        const next = new Set<number>();
        for (const C of levels[a]) for (const nx of successors(s, C, a)) if (!settle(s, nx.C, a + 1).over) next.add(nx.C);
        levels.push(next);
      }
      let U = new Map<number, number>();
      for (let a = s.k - 1; a >= 0; a--) {
        const prev = new Map<number, number>();
        for (const C of levels[a]) {
          let cont = 0;
          for (const nx of successors(s, C, a)) {
            const r = settle(s, nx.C, a + 1);
            cont += nx.w * (r.over ? r.value : U.get(nx.C)!);
          }
          const v = cashOut(s, C, a);
          const u = a === 0 ? cont : Math.max(v, cont);
          expect(Math.abs(u - v)).toBeLessThan(1e-12 * prizeFor(s));
          prev.set(C, u);
        }
        U = prev;
      }
      expect(U.get(0)!).toBeCloseTo(RTP, 12);
    }
  });

  it('strategies (a)–(d) return exactly RTP on every 4×4 setting and 5×5 eval config (all 22 in the heavy run; exact DP)', () => {
    for (const s of EXACT) for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(s, stop) - RTP)).toBeLessThan(1e-10);
  });

  it('strategies (a)–(d) through nextSeed / addSeed on every eval config: RTP within 4 SE, max ≤ maxMultiplier', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      const s = EVAL[ci];
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(s, stop, r), ROUNDS, 9100 + 13 * ci + si);
        rows.push(`${cfg.label.padEnd(36)} ${name.padEnd(48)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exactValue(s, stop) * 100).toFixed(4)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
