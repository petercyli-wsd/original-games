// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = cashValue(series) = prize × P(win | series), prize =
// RTP / p_side^games. Bet plays the first mark at once. At a checkpoint the
// player can cash out, play one mark ("Next mark", which also plays any marks
// of a game whose result is already certain), or play the current game out;
// side and games are locked while live. A mark lands on a uniformly random
// empty cell, so every action has finitely many outcomes and we enumerate
// them EXACTLY by driving the game's own plan() with a scripted Rng that walks
// every branch of its rng.int calls. Then:
//   * the one-step martingale holds at every checkpoint state of every
//     setting (all 9 side × games pairs), for "Next mark", and for "Play the
//     game out" wherever the game has at most 4 empty cells;
//   * the adversarial stopping rules' RTPs are exact (backward induction over
//     the checkpoint states) and equal RTP;
//   * a Monte Carlo of the same rules with the real RNG agrees within 4 SE,
//     including "Play the game out" at every checkpoint (the Auto path).
// FAIRNESS_ROUNDS=200000 raises the Monte Carlo to the full audit size.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { GAMES, MAX_MULTIPLIER, RTP, SIDES, VOLATILITY, cashValue, emptyCells, newSeries, plan, prizeFor, type Games, type Mode, type Move, type Series, type Side } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 3_000);
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS || !!import.meta.env.FAIRNESS_SE;

/** FAIRNESS_SE=0.003 keeps each Monte Carlo cell going (in 50k batches, up to 100M rounds) until its standard error is at most that. */
const SE_TARGET = Number(import.meta.env.FAIRNESS_SE ?? 0);
function monteCarlo(play: () => number): { n: number; mean: number; se: number; max: number } {
  let n = 0;
  let sum = 0;
  let sq = 0;
  let max = 0;
  const se = () => Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2) / n);
  for (;;) {
    const m = play();
    n++;
    sum += m;
    sq += m * m;
    if (m > max) max = m;
    if (n >= ROUNDS && (!SE_TARGET || (n % 50_000 === 0 && (se() <= SE_TARGET || n >= 100_000_000)))) break;
  }
  return { n, mean: sum / n, se: se(), max };
}

/** Every outcome of `run` with its exact probability, by walking each branch of its rng.int calls. */
function enumerate<T>(run: (rng: Rng) => T): { p: number; value: T }[] {
  const out: { p: number; value: T }[] = [];
  const todo: number[][] = [[]];
  while (todo.length) {
    const path = todo.pop()!;
    let pos = 0;
    let p = 1;
    const rng: Rng = {
      int(n) {
        if (pos === path.length) {
          for (let c = 1; c < n; c++) todo.push([...path, c]);
          path.push(0);
        }
        p /= n;
        return path[pos++];
      },
      next() {
        throw new Error('plan should only use rng.int');
      },
      shuffle() {
        throw new Error('plan should only use rng.int');
      },
    };
    const value = run(rng);
    out.push({ p, value });
  }
  return out;
}

/** The value right after an action: prize if won, 0 if lost, else the cash-out. */
const valueAfter = (s: Series) => (s.status === 'won' ? prizeFor(s.side, s.games) : s.status === 'lost' ? 0 : cashValue(s));
const keyOf = (s: Series) => `${s.side}${s.games}|${s.won}|${s.grid.join('')}`;
const lastOf = (moves: Move[]) => moves[moves.length - 1].next;

/** Exact outcomes of one "Next mark", cached per state. */
const moveCache = new Map<string, { p: number; next: Series; ended: boolean }[]>();
function moveOutcomes(s: Series) {
  const k = keyOf(s);
  let o = moveCache.get(k);
  if (!o) {
    o = enumerate((rng) => plan(s, 'move', rng)).map(({ p, value }) => ({ p, next: lastOf(value), ended: value[value.length - 1].ended !== null }));
    moveCache.set(k, o);
  }
  return o;
}

/** Every checkpoint state of a setting: reachable from Bet (one mark) by "Next mark" actions. */
function checkpoints(side: Side, games: Games): Series[] {
  const seen = new Map<string, Series>();
  const todo: Series[] = moveOutcomes(newSeries(side, games)).map((o) => o.next);
  while (todo.length) {
    const s = todo.pop()!;
    if (s.status !== 'live' || seen.has(keyOf(s))) continue;
    seen.set(keyOf(s), s);
    for (const o of moveOutcomes(s)) todo.push(o.next);
  }
  return [...seen.values()];
}

interface View {
  s: Series;
  v: number;
  /** Chance the next mark doesn't lose the round outright. */
  safe: number;
  /** The next mark can end the round lost. */
  canLose: boolean;
  /** Between games (a fresh board after a game won your way). */
  boundary: boolean;
}
type Rule = (x: View) => boolean; // true = cash out now

const viewCache = new Map<string, View>();
function view(s: Series): View {
  const key = keyOf(s);
  let x = viewCache.get(key);
  if (!x) {
    const mo = moveOutcomes(s);
    const safe = mo.reduce((a, o) => a + (o.next.status === 'lost' ? 0 : o.p), 0);
    viewCache.set(key, (x = { s, v: cashValue(s), safe, canLose: safe < 1, boundary: s.won > 0 && emptyCells(s.grid).length === 9 }));
  }
  return x;
}

const RULES: Record<string, Rule> = {
  // (a) the tester's: mark only while the next mark is ≥ 80% safe.
  'a ≥80% safe': (x) => x.safe < 0.8,
  // (b) take any profit.
  'b any profit': (x) => x.v > 1,
  // (c) play every game out, one mark at a time.
  'c to the end': () => false,
  // (d) bank at a game boundary when ahead, bank before any mark that can
  // lose outright when not behind, otherwise keep marking.
  'd bank at boundaries': (x) => (x.boundary && x.v > 1) || (x.canLose && x.v >= RTP),
};

function exactValue(side: Side, games: Games, rule: Rule): number {
  const memo = new Map<string, number>();
  const go = (s: Series, first: boolean): number => {
    if (s.status !== 'live') return valueAfter(s);
    const key = keyOf(s) + (first ? '!' : '');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const out = !first && rule(view(s)) ? cashValue(s) : moveOutcomes(s).reduce((a, o) => a + o.p * go(o.next, false), 0);
    memo.set(key, out);
    return out;
  };
  return go(newSeries(side, games), true);
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, c]) => ({ label: `${level} ${c.side}×${c.games}`, ...c }));

describe('Noughts fairness', () => {
  const settings = SIDES.flatMap((side) => GAMES.map((games) => ({ side, games })));
  const states = new Map(settings.map(({ side, games }) => [`${side}${games}`, checkpoints(side, games)]));

  it('martingale for "Next mark" at every checkpoint of every setting (exact enumeration of plan)', () => {
    let n = 0;
    let worst = 0;
    for (const { side, games } of settings) {
      expect(cashValue(newSeries(side, games))).toBeCloseTo(RTP, 12);
      expect(prizeFor(side, games)).toBeLessThanOrEqual(MAX_MULTIPLIER);
      // The Bet's own first mark is a fair step too.
      const all = [newSeries(side, games), ...states.get(`${side}${games}`)!];
      for (const s of all) {
        const mo = moveOutcomes(s);
        expect(Math.abs(mo.reduce((a, o) => a + o.p, 0) - 1)).toBeLessThan(1e-12);
        const v = cashValue(s);
        const ev = mo.reduce((a, o) => a + o.p * valueAfter(o.next), 0);
        worst = Math.max(worst, Math.abs(ev - v) / Math.max(1, v));
        n++;
      }
    }
    expect(n).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('martingale for "Play the game out" wherever the game has at most 4 empty cells (1 and 2 games, every side)', () => {
    let n = 0;
    let worst = 0;
    // games = 1 (a play-out ends the round) and 2 (from game 1 it moves on to a fresh board; game 2 ends the round).
    for (const { side, games } of settings.filter((x) => x.games <= 2)) {
      for (const s of states.get(`${side}${games}`)!) {
        if (emptyCells(s.grid).length > 4) continue;
        const go = enumerate((rng) => plan(s, 'game', rng));
        // Each play-out ends the current game (or the round).
        let open = 0;
        for (const g of go) if (g.value[g.value.length - 1].ended === null && lastOf(g.value).status === 'live') open++;
        expect(open).toBe(0);
        const v = cashValue(s);
        const ev = go.reduce((a, o) => a + o.p * valueAfter(lastOf(o.value)), 0);
        worst = Math.max(worst, Math.abs(ev - v) / Math.max(1, v));
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(1e-12);
  });

  it('every adversarial stopping rule returns exactly RTP on every setting (backward induction)', () => {
    for (const { side, games } of settings) {
      for (const [name, rule] of Object.entries(RULES)) {
        const r = exactValue(side, games, rule);
        expect(Math.abs(r - RTP), `${side}×${games} ${name}: ${r}`).toBeLessThan(1e-12);
      }
    }
  });

  it('Monte Carlo with the real RNG agrees (4 SE), including "Play the game out" at every checkpoint', () => {
    const rows: string[] = [];
    const rules: Record<string, Rule | Mode> = { ...RULES, "c′ Play the game out": 'game' };
    for (const c of CONFIGS) {
      const prize = prizeFor(c.side, c.games);
      for (const [name, rule] of Object.entries(rules)) {
        const rng = createRng(seededSource(55));
        const { n, mean, se, max } = monteCarlo(() => {
          let s = lastOf(plan(newSeries(c.side, c.games), 'move', rng));
          let m: number;
          for (;;) {
            if (s.status !== 'live') {
              m = valueAfter(s);
              break;
            }
            if (rule !== 'game' && rule !== 'move' && rule(view(s))) {
              m = cashValue(s);
              break;
            }
            s = lastOf(plan(s, rule === 'game' ? 'game' : 'move', rng));
          }
          return m;
        });
        rows.push(`${c.label.padEnd(14)} ${name.padEnd(22)} ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%  n=${n}  (prize ${prize.toFixed(2)}×)`);
        expect(Math.abs(mean - RTP), `${c.label} ${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it('the eval configs are the same settings this file audits', () => {
    expect(evalSpec.configs.map((c) => c.params)).toEqual(Object.values(VOLATILITY));
  });
});
