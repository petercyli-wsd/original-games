// Fairness audit: no strategy can beat the RTP.
//
// The cash-out is V = prize × winChance(bet, tally), prize = RTP / P(win at
// the start). Bet plays the first draw at once. After that the player can cash
// out, draw one token into the next slot, or "Draw to the end"; the target is
// locked while live and slots always fill in order. A draw is uniform over the
// r tokens left in the bag, so every next event has finitely many outcomes and
// everything is EXACT: we drive the game's own drawNext with a scripted Rng
// that returns each sector in turn, and check
//   * the one-step martingale at every reachable live state of every target;
//   * the value of each adversarial stopping rule (backward induction over the
//     real boards) equals RTP;
//   * a Monte Carlo of the same rules with the real RNG agrees within 4 SE,
//     plus "Draw to the end" through drawToEnd (the Auto path).
// FAIRNESS_ROUNDS=200000 raises the Monte Carlo to the full audit size.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BETS,
  MAX_MULTIPLIER,
  RTP,
  VOLATILITY,
  betDef,
  bag,
  decided,
  drawNext,
  drawToEnd,
  emptyBoard,
  isOpen,
  matchEffect,
  nextSlot,
  place,
  prizeFor,
  tally,
  winChance,
  type BetDef,
  type Placed,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);
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

/** An Rng whose int() returns a fixed value: drives drawNext down one branch. */
const fixed = (i: number): Rng => ({
  int: () => i,
  next: () => {
    throw new Error('drawNext should only use rng.int');
  },
  shuffle: () => {
    throw new Error('drawNext should only use rng.int');
  },
});

/** The value of a board after a draw: prize / 0 once decided, else prize × chance. */
function valueOf(bet: BetDef, prize: number, placed: Placed): number {
  const t = tally(placed);
  const end = decided(bet, t);
  return end === 'won' ? prize : end === 'lost' ? 0 : prize * winChance(bet, t);
}

/** Every outcome of the next draw (each with chance 1/r), via the real drawNext. */
function children(placed: Placed): Placed[] {
  const r = bag(placed).length;
  return Array.from({ length: r }, (_, i) => {
    const d = drawNext(placed, fixed(i));
    if (d.of !== r || d.slot !== nextSlot(placed)) throw new Error('drawNext is not a uniform draw into the next slot');
    return place(placed, d.slot, d.token);
  });
}

/** The values after each next draw, cached per (target, future-relevant state). */
const afterCache = new Map<string, number[]>();
function afterValues(bet: BetDef, prize: number, placed: Placed): number[] {
  const key = bet.id + '#' + keyOf(placed);
  let a = afterCache.get(key);
  if (!a) afterCache.set(key, (a = children(placed).map((k) => valueOf(bet, prize, k))));
  return a;
}

interface View {
  bet: BetDef;
  prize: number;
  placed: Placed;
  v: number;
  /** The values after each equally likely next draw. */
  after: number[];
}
type Rule = (s: View) => boolean; // true = cash out now

const RULES: Record<string, Rule> = {
  // (a) the tester's: draw only while the next draw keeps the round alive with chance ≥ 0.8.
  'a ≥80% safe': (s) => s.after.filter((x) => x > 0).length / s.after.length < 0.8,
  // (b) take any profit.
  'b any profit': (s) => s.v > 1,
  // (c) play to the end.
  'c to the end': () => false,
  // (d) draw only when the next draw is more likely to raise the cash-out than
  // lower it (and always into a slot that can't match, a free "dud" draw when
  // it changes nothing); otherwise bank.
  'd ride the upswings': (s) => {
    const up = s.after.filter((x) => x > s.v + 1e-12).length;
    const down = s.after.filter((x) => x < s.v - 1e-12).length;
    return down > up;
  },
};

/** Memo key for the future: matches so far and which empty slots (a suffix, in order) can still match. */
const keyOf = (placed: Placed) => `${tally(placed).m}|${placed.map((t, i) => (t === null ? (isOpen(placed, i) ? 'o' : 'x') : '')).join('')}`;

function exactValue(bet: BetDef, rule: Rule): number {
  const prize = prizeFor(bet);
  const memo = new Map<string, number>();
  const go = (placed: Placed, first: boolean): number => {
    const t = tally(placed);
    const end = decided(bet, t);
    if (end) return end === 'won' ? prize : 0;
    const key = keyOf(placed) + (first ? '!' : '');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const kids = children(placed);
    const v = prize * winChance(bet, t);
    let out: number;
    if (!first && rule({ bet, prize, placed, v, after: kids.map((k) => valueOf(bet, prize, k)) })) out = v;
    else out = kids.reduce((a, k) => a + go(k, false), 0) / kids.length;
    memo.set(key, out);
    return out;
  };
  return go(emptyBoard(), true);
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, id]) => ({ label: `${level} ${id}`, bet: betDef(id) }));

describe('Mismatch fairness', () => {
  it('martingale at every reachable live state of every target (exact, through the real drawNext)', () => {
    let states = 0;
    let worst = 0;
    for (const bet of BETS) {
      const prize = prizeFor(bet);
      expect(prize * winChance(bet, tally(emptyBoard()))).toBeCloseTo(RTP, 12);
      expect(prize).toBeLessThanOrEqual(MAX_MULTIPLIER);
      const seen = new Set<string>();
      const todo: Placed[] = [emptyBoard()];
      while (todo.length) {
        const placed = todo.pop()!;
        const key = keyOf(placed);
        if (seen.has(key)) continue;
        seen.add(key);
        const t = tally(placed);
        if (decided(bet, t)) continue;
        const v = prize * winChance(bet, t);
        const kids = children(placed);
        const ev = kids.reduce((a, k) => a + valueOf(bet, prize, k), 0) / kids.length;
        worst = Math.max(worst, Math.abs(ev - v) / Math.max(1, v));
        states++;
        // matchEffect (the slice colour) is the true direction of a match.
        if (isOpen(placed, nextSlot(placed))) {
          const match = kids.find((k) => k[nextSlot(placed)] === nextSlot(placed))!;
          const vm = valueOf(bet, prize, match);
          const eff = matchEffect(bet, t);
          expect(eff === 'up' ? vm > v : eff === 'down' ? vm < v : Math.abs(vm - v) < 1e-12).toBe(true);
        }
        todo.push(...kids);
      }
    }
    expect(states).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-12);
  });

  it('every adversarial stopping rule returns exactly RTP on every target (backward induction)', () => {
    for (const bet of BETS) {
      for (const [name, rule] of Object.entries(RULES)) {
        const r = exactValue(bet, rule);
        expect(Math.abs(r - RTP), `${bet.id} ${name}: ${r}`).toBeLessThan(1e-12);
      }
    }
  });

  it('Monte Carlo with the real RNG agrees (4 SE), including "Draw to the end" via drawToEnd', () => {
    const rows: string[] = [];
    const rules: Record<string, Rule | 'auto'> = { ...RULES, 'c′ Draw to the end': 'auto' };
    for (const c of CONFIGS) {
      const prize = prizeFor(c.bet);
      for (const [name, rule] of Object.entries(rules)) {
        const rng = createRng(seededSource(91));
        const { n, mean, se, max } = monteCarlo(() => {
          // Bet: the first draw.
          const d0 = drawNext(emptyBoard(), rng);
          let placed = place(emptyBoard(), d0.slot, d0.token);
          let m: number;
          for (;;) {
            const t = tally(placed);
            const end = decided(c.bet, t);
            if (end) {
              m = end === 'won' ? prize : 0;
              break;
            }
            if (rule === 'auto') {
              for (const d of drawToEnd(placed, c.bet, rng)) placed = place(placed, d.slot, d.token);
              continue;
            }
            const v = prize * winChance(c.bet, t);
            if (rule({ bet: c.bet, prize, placed, v, after: afterValues(c.bet, prize, placed) })) {
              m = v;
              break;
            }
            const d = drawNext(placed, rng);
            placed = place(placed, d.slot, d.token);
          }
          return m;
        });
        rows.push(`${c.label.padEnd(18)} ${name.padEnd(20)} ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%  n=${n}`);
        expect(Math.abs(mean - RTP), `${c.label} ${name}: ${mean} ± ${se}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it('the eval configs are the same targets this file audits', () => {
    expect(evalSpec.configs.map((c) => c.params.bet)).toEqual(Object.values(VOLATILITY));
  });
});
