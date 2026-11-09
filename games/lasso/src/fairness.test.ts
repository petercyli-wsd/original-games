// Fairness audit: can any way of playing Lasso beat the RTP?
//
// Field, steps and loops are fixed at the bet (the chips are disabled while
// live). Bet walks the first burst of BURST steps at once; then at each
// checkpoint the player may cash out or walk the next burst. Game.tsx's
// burst() draws the whole burst up front with walk(), which stops early once
// the chance is exactly 0 or 1, and pays prize / 0 there. Every button is
// hidden while the walker animates.
//
// A burst has at most 4^5 = 1024 paths, so every check is exact:
//   - martingale: at ≥ 30 states reached by random rounds (every eval config
//     and every field/steps/loops setting, including the last burst and
//     states one step from settling), the burst's outcomes are enumerated
//     through walk() itself, and the mean cash-out after the burst equals
//     the cash-out now;
//   - strategies: exact DP over (cell, winding, steps left), then Monte Carlo
//     through walk():
//       (a) the tester's: walk a burst only while it is ≥ 80% safe (the
//           chance the round is not lost by its end), else cash out;
//       (b) take any profit: cash out the moment the cash-out exceeds the bet;
//       (c) walk to the end;
//       (d) read the heat map: cash out when the walker's cell has cooled to
//           under a third of the start chance (stop-loss) or once the chance
//           is ≥ 90% (lock in a lasso that can still unwind); otherwise walk.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BURST,
  FIELDS,
  LAPS,
  MAX_MULTIPLIER,
  RTP,
  START,
  STEPS,
  allowed,
  chance,
  crossing,
  neighbours,
  prizeFor,
  walk,
  winChance,
  type Cell,
  type Settings,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

interface Pos {
  at: Cell;
  w: number;
  left: number;
}

/** The value Game.tsx settles or shows after a burst ending with chance p. */
const valueAt = (s: Settings, p: number) => (p === 1 ? prizeFor(s) : p === 0 ? 0 : prizeFor(s) * p);

/** Every outcome of one burst from pos, enumerated through walk() one step at a time (u picks each neighbour). */
function burstOutcomes(s: Settings, pos: Pos): { pos: Pos; p: number; prob: number }[] {
  const out: { pos: Pos; p: number; prob: number }[] = [];
  const go = (q: Pos, p: number, prob: number, taken: number) => {
    if (taken === BURST || q.left === 0 || p === 0 || p === 1) return void out.push({ pos: q, p, prob });
    const n = neighbours(s.field, q.at).length;
    for (let i = 0; i < n; i++) {
      const r = walk(s, q.at, q.w, q.left, 1, () => (i + 0.5) / n);
      expect(r.cells.length).toBe(1);
      go({ at: r.cells[0], w: r.w, left: r.left }, r.p, prob / n, taken + 1);
    }
  };
  go(pos, chance(s.field, s.laps, pos.at, pos.w, pos.left), 1, 0);
  return out;
}

type Policy = (s: Settings, pos: Pos, p: number) => 'cash' | 'walk';

/** Exact value of a policy by DP over single steps; checkpoints fall every BURST steps from the start. */
function exactRtp(s: Settings, policy: Policy): number {
  const memo = new Map<string, number>();
  const V = (at: Cell, w: number, left: number): number => {
    const p = chance(s.field, s.laps, at, w, left);
    if (p === 0 || p === 1) return valueAt(s, p);
    const taken = s.steps - left;
    const key = `${at.x},${at.y}|${w}|${left}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v: number;
    if (taken > 0 && taken % BURST === 0 && policy(s, { at, w, left }, p) === 'cash') v = prizeFor(s) * p;
    else {
      const nb = neighbours(s.field, at);
      v = nb.reduce((acc, n) => acc + V(n, w + crossing(at, n), left - 1), 0) / nb.length;
    }
    memo.set(key, v);
    return v;
  };
  return V(START, 0, s.steps);
}

/** Exact chance that a burst from pos ends the round as a loss. */
const lossMemo = new Map<string, number>();
function burstLoss(s: Settings, pos: Pos, k = BURST): number {
  const p = chance(s.field, s.laps, pos.at, pos.w, pos.left);
  if (p === 0) return 1;
  if (p === 1 || k === 0 || pos.left === 0) return 0;
  const key = `${s.field}|${s.laps}|${pos.at.x},${pos.at.y}|${pos.w}|${pos.left}|${k}`;
  const hit = lossMemo.get(key);
  if (hit !== undefined) return hit;
  const nb = neighbours(s.field, pos.at);
  const v = nb.reduce((acc, n) => acc + burstLoss(s, { at: n, w: pos.w + crossing(pos.at, n), left: pos.left - 1 }, k - 1), 0) / nb.length;
  lossMemo.set(key, v);
  return v;
}

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) walk only while the burst is ≥ 80% safe', policy: (s, pos) => (1 - burstLoss(s, pos) >= 0.8 ? 'walk' : 'cash') },
  { name: '(b) take any profit', policy: (s, _pos, p) => (prizeFor(s) * p > 1 ? 'cash' : 'walk') },
  { name: '(c) walk to the end', policy: () => 'walk' },
  { name: '(d) heat-map stop-loss / lock-in', policy: (s, _pos, p) => (p < winChance(s) / 3 || p >= 0.9 ? 'cash' : 'walk') },
];

/** One round as Game.tsx plays it: walk() draws each burst, the policy acts at each checkpoint. */
function play(s: Settings, policy: Policy, rng: Rng): number {
  let pos: Pos = { at: START, w: 0, left: s.steps };
  for (;;) {
    const r = walk(s, pos.at, pos.w, pos.left, BURST, () => rng.next());
    pos = { at: r.cells.length ? r.cells[r.cells.length - 1] : pos.at, w: r.w, left: r.left };
    if (r.p === 0 || r.p === 1) return valueAt(s, r.p);
    if (policy(s, pos, r.p) === 'cash') return prizeFor(s) * r.p;
  }
}

const ALL: Settings[] = FIELDS.flatMap((field) => STEPS.flatMap((steps) => LAPS.filter((laps) => allowed(steps, laps)).map((laps) => ({ field, steps, laps }))));

/** Checkpoints met while playing random rounds out. */
function reachedStates(count: number, rng: Rng): { s: Settings; pos: Pos }[] {
  const out: { s: Settings; pos: Pos }[] = [];
  const settings = [...evalSpec.configs.map((c) => c.params), ...ALL];
  for (let i = 0; out.length < count; i++) {
    const s = settings[i % settings.length];
    let pos: Pos = { at: START, w: 0, left: s.steps };
    for (;;) {
      const r = walk(s, pos.at, pos.w, pos.left, BURST, () => rng.next());
      pos = { at: r.cells.length ? r.cells[r.cells.length - 1] : pos.at, w: r.w, left: r.left };
      if (r.p === 0 || r.p === 1) break;
      if (rng.next() < 0.4) out.push({ s, pos });
    }
  }
  return out.slice(0, count);
}

function mc(play_: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play_(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Lasso fairness', () => {
  it('martingale, exact: at ≥ 30 reached states (and the opening burst), a burst through walk() is a fair bet', () => {
    const rng = createRng(seededSource(4242));
    const states = [...reachedStates(60, rng), ...ALL.map((s) => ({ s, pos: { at: START, w: 0, left: s.steps } }))];
    expect(states.some(({ pos }) => pos.left <= BURST)).toBe(true);
    expect(states.some(({ s, pos }) => burstLoss(s, pos, 1) > 0)).toBe(true);
    for (const { s, pos } of states) {
      const V = prizeFor(s) * chance(s.field, s.laps, pos.at, pos.w, pos.left);
      const outs = burstOutcomes(s, pos);
      expect(outs.reduce((a, o) => a + o.prob, 0)).toBeCloseTo(1, 12);
      const after = outs.reduce((a, o) => a + o.prob * valueAt(s, o.p), 0);
      expect(Math.abs(after - V)).toBeLessThan(1e-11 * Math.max(1, V));
    }
  });

  it('every bet is worth RTP: the opening burst is fair on every setting', () => {
    for (const s of ALL) expect(exactRtp(s, () => 'walk')).toBeCloseTo(RTP, 10);
  });

  it('every strategy returns exactly RTP on every eval config and every setting (exact DP)', () => {
    for (const s of ALL) for (const { policy } of STRATEGIES) expect(exactRtp(s, policy)).toBeCloseTo(RTP, 10);
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const s = cfg.params;
      const r = mc((g) => play(s, policy, g), ROUNDS, 700 + i * 17 + name.length);
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${cfg.label} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | exact ${(exactRtp(s, policy) * 100).toFixed(6)}% | max ${r.max.toFixed(2)}`);
      expect(Math.abs(r.mean - RTP)).toBeLessThanOrEqual(4 * r.se + 1e-9);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    });
  });
});
