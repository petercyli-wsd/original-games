// Fairness audit: can any way of playing Full Set beat the RTP?
//
// Decisions in a round: at each checkpoint, cash out, "Draw once" or "Hunt"
// (draw until a new segment lights or the spares run out). Ring size and
// budget are locked while live; the prize RTP / P(win) is locked at the bet;
// the first draw is made with the bet and always lights a segment. Pace is a
// real choice (it changes how many draws are spent before the next decision),
// so both moves must keep the value, and the strongest mix of paces and stops
// must not beat RTP.
//
// Checks, on the real advance() / winChance() / prizeFor() and Game.tsx's
// cash rule (m = 0 → prize, d < m → 0, else prize × W(m, d)):
//   - martingale, exact: at 40+ reached states (every ring, random budgets and
//     paces, no-spare and last-segment states, the largest prizes), for both
//     moves, every outcome of advance() is enumerated by feeding it scripted
//     landing points: segment by segment when the tree is small, else by
//     class (which draws repeat), and E[V after] must equal V to 1e-12;
//   - optimal play, exact: the Snell envelope over {cash out, draw once,
//     hunt} on every (m, d) of every ring and budget equals V, so no policy,
//     however it mixes paces and stops, returns more than RTP;
//   - strategies (a) tester's: hunt if the hunt is ≥ 80% to light a new
//     segment, else draw once if that draw is ≥ 80% safe, else cash out;
//     (b) take any profit (hunting); (c) hunt to the end; (d) max variance:
//     draw once while spares remain, hunt with none, never cash out below
//     the prize unless the cash-out has passed 2×; exact RTP by dynamic
//     programming for each, plus Monte Carlo through advance().

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BUDGETS, RTP, SEGMENTS, advance, darkCount, huntChance, litOf, prizeFor, winChance, type Draw, type Pace, type Segments } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

interface State {
  k: Segments;
  D: number;
  draws: Draw[];
}

const leftOf = (s: State) => s.D - s.draws.length;

/** Game.tsx's cash rule after a move (move()): prize at a full set, 0 once out of reach, else prize × W. */
function cashOf(k: number, D: number, draws: readonly Draw[]): number {
  const prize = prizeFor(k, D);
  const m = darkCount(litOf(k, draws));
  const left = D - draws.length;
  return m === 0 ? prize : left < m ? 0 : prize * winChance(k, m, left);
}

/** An Rng that replays `script` and throws when it runs out (the enumeration then branches). */
class NeedDraw extends Error {}
function scripted(script: number[]): Rng & { used: () => number } {
  let i = 0;
  return {
    next: () => {
      if (i >= script.length) throw new NeedDraw();
      return script[i++];
    },
    int: () => 0,
    shuffle: (a) => a.slice(),
    used: () => i,
  };
}

/** Exact E[V after one move], branching on every segment (each 1/k) until advance() completes. */
function expectedAfterFull(s: State, pace: Pace): { ev: number; leaves: number } {
  const lit = litOf(s.k, s.draws);
  let ev = 0;
  let leaves = 0;
  const walk = (script: number[], prob: number) => {
    const rng = scripted(script);
    try {
      const drawn = advance(s.k, lit, leftOf(s), pace, rng);
      expect(rng.used()).toBe(script.length);
      ev += prob * cashOf(s.k, s.D, [...s.draws, ...drawn]);
      leaves++;
    } catch (e) {
      if (!(e instanceof NeedDraw)) throw e;
      for (let seg = 0; seg < s.k; seg++) walk([...script, (seg + 0.5) / s.k], prob / s.k);
    }
  };
  walk([], 1);
  return { ev, leaves };
}

/** Number of leaves the full tree would have (to choose full vs class enumeration). */
function treeSize(s: State, pace: Pace): number {
  const m = darkCount(litOf(s.k, s.draws));
  const lit = s.k - m;
  if (pace === 'draw') return s.k;
  const spares = leftOf(s) - m;
  let n = lit ** (spares + 1);
  for (let g = 1; g <= spares + 1; g++) n += lit ** (g - 1) * m;
  return n;
}

/**
 * Exact E[V after one move] by class: each draw either repeats (any lit
 * segment, chance lit/k) or is new (any dark one, chance m/k). Every
 * sequence in a class ends in the same (m, d), so one representative each.
 */
function expectedAfterByClass(s: State, pace: Pace): number {
  const lit = litOf(s.k, s.draws);
  const litSeg = lit.indexOf(true);
  const darkSeg = lit.indexOf(false);
  const m = darkCount(lit);
  const at = (seg: number) => (seg + 0.5) / s.k;
  const maxRepeats = pace === 'draw' ? 1 : leftOf(s) - m + 1;
  let ev = 0;
  // r repeats then a new segment (r < maxRepeats, or r = 0 for a single draw) …
  for (let r = 0; r < maxRepeats; r++) {
    const script = [...Array<number>(r).fill(at(litSeg)), at(darkSeg)];
    if (pace === 'draw' && r > 0) break;
    const rng = scripted(script);
    const drawn = advance(s.k, lit, leftOf(s), pace, rng);
    expect(rng.used()).toBe(script.length);
    ev += ((1 - m / s.k) ** r * (m / s.k)) * cashOf(s.k, s.D, [...s.draws, ...drawn]);
  }
  // … or only repeats: one for a single draw, all the spares + 1 for a hunt.
  if (litSeg >= 0) {
    const script = Array<number>(maxRepeats).fill(at(litSeg));
    const rng = scripted(script);
    const drawn = advance(s.k, lit, leftOf(s), pace, rng);
    expect(rng.used()).toBe(script.length);
    ev += (1 - m / s.k) ** maxRepeats * cashOf(s.k, s.D, [...s.draws, ...drawn]);
  }
  return ev;
}

/** Live checkpoints met while playing random rounds with random paces (first move: one draw, as at the bet). */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const k = SEGMENTS[out.length % SEGMENTS.length];
    const { min, max } = BUDGETS[k];
    const D = rng.next() < 0.3 ? min : min + rng.int(max - min + 1);
    let draws: Draw[] = [];
    for (let move = 0; ; move++) {
      const pace: Pace = move === 0 ? 'draw' : rng.next() < 0.5 ? 'draw' : 'hunt';
      draws = [...draws, ...advance(k, litOf(k, draws), D - draws.length, pace, rng)];
      const m = darkCount(litOf(k, draws));
      if (m === 0 || D - draws.length < m) break;
      if (rng.next() < 0.4 || D - draws.length === m || m === 1) out.push({ k, D, draws });
    }
  }
  return out.slice(0, count);
}

type Policy = (k: number, m: number, d: number, cash: number) => Pace | 'stop';

const POLICIES: { name: string; policy: Policy }[] = [
  {
    name: '(a) tester: act only if ≥ 80% safe',
    policy: (k, m, d) => (huntChance(k, m, d) >= 0.8 ? 'hunt' : (d > m ? 1 : m / k) >= 0.8 ? 'draw' : 'stop'),
  },
  { name: '(b) take any profit (hunting)', policy: (_k, _m, _d, cash) => (cash > 1 ? 'stop' : 'hunt') },
  { name: '(c) hunt to the end', policy: () => 'hunt' },
  { name: '(d) draw once while spares, hunt at none, stop past 2×', policy: (_k, m, d, cash) => (cash > 2 ? 'stop' : d > m ? 'draw' : 'hunt') },
];

/** Exact RTP of a policy on (k, D), by DP over (m dark, d left); the bet's first draw always lights a segment. */
function exactPolicyValue(k: number, D: number, policy: Policy): number {
  const prize = prizeFor(k, D);
  const memo = new Map<number, number>();
  const V = (m: number, d: number): number => {
    if (m === 0) return prize;
    if (d < m) return 0;
    const key = m * 1000 + d;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const cash = prize * winChance(k, m, d);
    const act = policy(k, m, d, cash);
    let v: number;
    const p = m / k;
    if (act === 'stop') v = cash;
    else if (act === 'draw') v = p * V(m - 1, d - 1) + (1 - p) * V(m, d - 1);
    else {
      v = 0;
      for (let g = 1; g <= d - m + 1; g++) v += (1 - p) ** (g - 1) * p * V(m - 1, d - g);
    }
    memo.set(key, v);
    return v;
  };
  return V(k - 1, D - 1);
}

/** One round as Game.tsx plays it, through advance() with the seeded RNG. */
function playRound(k: Segments, D: number, policy: Policy, rng: Rng): number {
  let draws: Draw[] = [];
  let pace: Pace = 'draw';
  for (;;) {
    draws = [...draws, ...advance(k, litOf(k, draws), D - draws.length, pace, rng)];
    const m = darkCount(litOf(k, draws));
    const d = D - draws.length;
    const cash = cashOf(k, D, draws);
    if (m === 0 || d < m) return cash;
    const act = policy(k, m, d, cash);
    if (act === 'stop') return cash;
    pace = act;
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

describe('Full Set fairness', () => {
  it('martingale (exact): at 40+ reached states, both moves keep E[V after] = V, enumerating advance() outcomes', () => {
    const rng = createRng(seededSource(31337));
    const states = reachedStates(48, rng);
    expect(states.some((s) => leftOf(s) === darkCount(litOf(s.k, s.draws)))).toBe(true); // no spare left
    expect(states.some((s) => darkCount(litOf(s.k, s.draws)) === 1)).toBe(true); // last segment
    expect(states.some((s) => s.D === BUDGETS[s.k].min)).toBe(true); // the largest prizes
    let full = 0;
    for (const s of states) {
      const v = cashOf(s.k, s.D, s.draws);
      for (const pace of ['draw', 'hunt'] as const) {
        const byClass = expectedAfterByClass(s, pace);
        expect(Math.abs(byClass - v)).toBeLessThan(1e-12 * Math.max(1, v));
        if (treeSize(s, pace) <= 20_000) {
          const { ev } = expectedAfterFull(s, pace);
          expect(Math.abs(ev - v)).toBeLessThan(1e-12 * Math.max(1, v));
          full++;
        }
      }
    }
    expect(full).toBeGreaterThanOrEqual(40);
  });

  it('optimal play (exact): the Snell envelope over cash out / draw once / hunt equals the cash-out on every ring and budget', () => {
    for (const k of SEGMENTS) {
      for (let D = BUDGETS[k].min; D <= BUDGETS[k].max; D++) {
        const prize = prizeFor(k, D);
        // U(m, d) = max(V, E_draw U, E_hunt U), solved upward in d (every move uses at least one draw).
        const U: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(D + 1).fill(0));
        let worst = 0;
        for (let d = 0; d <= D; d++) {
          U[0][d] = prize;
          for (let m = 1; m <= k; m++) {
            if (d < m) continue;
            const p = m / k;
            const V = prize * winChance(k, m, d);
            const drawOnce = p * U[m - 1][d - 1] + (1 - p) * (d - 1 >= m ? U[m][d - 1] : 0);
            let hunt = 0;
            for (let g = 1; g <= d - m + 1; g++) hunt += (1 - p) ** (g - 1) * p * U[m - 1][d - g];
            U[m][d] = Math.max(V, drawOnce, hunt);
            worst = Math.max(worst, (U[m][d] - V) / prize);
          }
        }
        expect(worst).toBeLessThan(1e-12);
        expect(U[k - 1][D - 1] / prize / winChance(k, k, D)).toBeCloseTo(1, 12);
      }
    }
  });

  it('strategies (a)–(d): exact RTP on every ring and budget, and Monte Carlo on every eval config within 4 SE', () => {
    for (const { policy } of POLICIES) {
      for (const k of SEGMENTS) {
        for (let D = BUDGETS[k].min; D <= BUDGETS[k].max; D++) expect(exactPolicyValue(k, D, policy)).toBeCloseTo(RTP, 10);
      }
    }
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { k, D } }, ci) => {
      POLICIES.forEach(({ name, policy }, si) => {
        const { mean, se, max } = mc((r) => playRound(k, D, policy, r), ROUNDS, 9100 + 13 * ci + si);
        const exact = exactPolicyValue(k, D, policy);
        rows.push(`${label.padEnd(30)} ${name.padEnd(54)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exact * 100).toFixed(9)}%  max ${max.toFixed(1)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
