import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BLOCKS,
  LINE,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  cashValue,
  columns,
  crosses,
  join,
  maskOf,
  newRound,
  nextLoss,
  pivotChance,
  plan,
  prizeFor,
  remaining,
  startChance,
  totalOf,
  winChance,
  type Round,
} from './math';

const rng = createRng(seededSource(11));

/** Brute force: recurse over who joins next, straight from the definition. */
function bruteChance(i: number, order: number[]): number {
  const s = totalOf(order);
  if (s >= LINE || order.includes(i)) return 0;
  const rest = SIZES.flatMap((_, j) => (order.includes(j) ? [] : [j]));
  let p = 0;
  for (const j of rest) {
    if (j === i) p += s + SIZES[i] >= LINE ? 1 : 0;
    else if (s + SIZES[j] < LINE) p += bruteChance(i, [...order, j]);
  }
  return p / rest.length;
}

/** A random live round, a few joins in. */
function randomLive(): Round {
  for (;;) {
    let r = newRound(rng.int(BLOCKS));
    const steps = rng.int(5);
    for (let k = 0; k < steps && r.status === 'live'; k++) {
      const rest = remaining(r);
      r = join(r, rest[rng.int(rest.length)]);
    }
    if (r.status === 'live') return r;
  }
}

describe('Pivot maths', () => {
  it('sizes [7,5,4,3,2,1], line 16: Shapley–Shubik indices 27/60, 12/60, 9/60, 7/60, 4/60, 1/60', () => {
    const want = [27, 12, 9, 7, 4, 1].map((n) => n / 60);
    want.forEach((p, i) => expect(startChance(i)).toBeCloseTo(p, 14));
    expect(want.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
    // One knob: the blocks span at least 25:1 in win chance, bigger block = better chance.
    expect(startChance(0) / startChance(BLOCKS - 1)).toBeGreaterThanOrEqual(25);
    for (let i = 1; i < BLOCKS; i++) expect(startChance(i)).toBeLessThan(startChance(i - 1));
  });

  it('subset DP = brute force at random states', () => {
    for (let t = 0; t < 200; t++) {
      const r = randomLive();
      expect(pivotChance(r.backed, maskOf(r.order))).toBeCloseTo(bruteChance(r.backed, r.order), 12);
    }
  });

  it('random orders: each block is the pivot as often as its chance says', () => {
    const rounds = 60_000;
    const hits = new Array(BLOCKS).fill(0);
    for (let r = 0; r < rounds; r++) {
      const perm = [...Array(BLOCKS).keys()];
      for (let k = BLOCKS - 1; k > 0; k--) {
        const j = rng.int(k + 1);
        [perm[k], perm[j]] = [perm[j], perm[k]];
      }
      let s = 0;
      for (const j of perm) {
        s += SIZES[j];
        if (s >= LINE) {
          hits[j]++;
          break;
        }
      }
    }
    hits.forEach((h, i) => {
      const p = startChance(i);
      expect(Math.abs(h / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    });
  });

  it('martingale: the chances after each possible next join average to the chance now', () => {
    for (let t = 0; t < 200; t++) {
      const r = randomLive();
      const cols = columns(r);
      expect(cols.reduce((a, c) => a + c.p, 0) / cols.length).toBeCloseTo(winChance(r), 12);
      const nexts = cols.map((c) => join(r, c.block));
      const meanCash = nexts.reduce((a, n) => a + cashValue(n), 0) / nexts.length;
      expect(meanCash).toBeCloseTo(cashValue(r), 9);
      cols.forEach((c, k) => expect(c.p).toBeCloseTo(winChance(nexts[k]), 14));
      // "Safe" on the button = share of next joins that leave you a chance.
      expect(1 - nextLoss(cols)).toBeCloseTo(nexts.filter((n) => winChance(n) > 0).length / nexts.length, 14);
    }
    // At the start the cash-out is RTP for every block: the choice is EV-neutral.
    SIZES.forEach((_, i) => expect(cashValue(newRound(i))).toBeCloseTo(RTP, 12));
  });

  it('the waiting blocks on the board: red exactly when joining next leaves no chance; the crossing picture is the real rule', () => {
    for (let t = 0; t < 300; t++) {
      const r = randomLive();
      const cols = columns(r);
      for (const c of cols) {
        const n = join(r, c.block);
        const over = crosses(r, c.block);
        // Drawn standing on the stack, a block crosses the line iff its joining ends the round.
        expect(n.status !== 'live').toBe(over || c.block === r.backed);
        if (c.block === r.backed) {
          // Yours: crossing wins (green), landing short loses (red, too early).
          expect(c.ends).toBe(over ? 'won' : 'lost');
          expect(c.p).toBe(over ? 1 : 0);
        } else if (over) {
          // Another block crossing first knocks you out.
          expect(c.ends).toBe('lost');
          expect(c.p).toBe(0);
        }
      }
      // The red count over the waiting count is the true chance the next join leaves you nothing.
      const red = cols.filter((c) => c.p === 0).length;
      expect(red / cols.length).toBeCloseTo(nextLoss(cols), 14);
      const dead = cols.filter((c) => winChance(join(r, c.block)) === 0).length;
      expect(red).toBe(dead);
    }
  });

  it('a planned action ends the round, or stops at a state that is neither certain nor lost', () => {
    for (let t = 0; t < 300; t++) {
      const r = randomLive();
      const joins = plan(r, rng);
      const last = joins[joins.length - 1];
      for (const j of joins.slice(0, -1)) expect([0, 1]).toContain(winChance(j));
      if (last.status === 'live') {
        expect(winChance(last)).toBeGreaterThan(0);
        expect(winChance(last)).toBeLessThan(1);
      } else {
        // Every loss is one of the two shown on the bar.
        expect(['won', 'early', 'passed']).toContain(last.ending);
        if (last.ending === 'won') expect(totalOf(last.order)).toBeGreaterThanOrEqual(LINE);
        if (last.ending === 'early') expect(totalOf(last.order)).toBeLessThan(LINE);
        if (last.ending === 'passed') expect(last.order).not.toContain(last.backed);
      }
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(Math.max(...SIZES.map((_, i) => prizeFor(i))), 9);
    expect(MAX_MULTIPLIER).toBeCloseTo(59.4, 9);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });
});
