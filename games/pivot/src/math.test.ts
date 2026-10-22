import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COMMITTEES,
  COMMITTEE_IDS,
  RTP,
  cashValue,
  coalitionSum,
  columns,
  join,
  maskOf,
  newRound,
  pivotChance,
  plan,
  prizeFor,
  remaining,
  shadedShare,
  shapley,
  tipZone,
  winChance,
  type CommitteeId,
  type Round,
} from './math';

const rng = createRng(seededSource(11));

/** Brute force: recurse over who joins next, straight from the definition. */
function bruteChance(cid: CommitteeId, i: number, order: number[]): number {
  const { weights, quota } = COMMITTEES[cid];
  const s = order.reduce((a, j) => a + weights[j], 0);
  if (s >= quota || order.includes(i)) return 0;
  const rest = weights.flatMap((_, j) => (order.includes(j) ? [] : [j]));
  let p = 0;
  for (const j of rest) {
    if (j === i) p += s + weights[i] >= quota ? 1 : 0;
    else if (s + weights[j] < quota) p += bruteChance(cid, i, [...order, j]);
  }
  return p / rest.length;
}

/** A random live round, a few joins in. */
function randomLive(cid: CommitteeId): Round {
  for (;;) {
    let r = newRound(cid, rng.int(COMMITTEES[cid].weights.length));
    const steps = rng.int(5);
    for (let k = 0; k < steps && r.status === 'live'; k++) {
      const rest = remaining(r);
      r = join(r, rest[rng.int(rest.length)]);
    }
    if (r.status === 'live') return r;
  }
}

describe('Pivot maths', () => {
  it('Council [5,4,3,2,1], quota 9: Shapley–Shubik indices 11/30, 17/60, 1/5, 7/60, 1/30', () => {
    const want = [11 / 30, 17 / 60, 1 / 5, 7 / 60, 1 / 30];
    want.forEach((p, i) => expect(shapley('council', i)).toBeCloseTo(p, 14));
  });

  it('every committee: indices sum to 1, all voters have power, subset DP = brute force', () => {
    for (const cid of COMMITTEE_IDS) {
      const phis = COMMITTEES[cid].weights.map((_, i) => shapley(cid, i));
      expect(phis.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      for (const p of phis) expect(p).toBeGreaterThan(0);
      for (let t = 0; t < 15; t++) {
        const r = randomLive(cid);
        expect(pivotChance(cid, r.backed, maskOf(r.order))).toBeCloseTo(bruteChance(cid, r.backed, r.order), 12);
      }
    }
  });

  it('random orders: each voter is the pivot as often as its index says', () => {
    for (const cid of COMMITTEE_IDS) {
      const { weights, quota } = COMMITTEES[cid];
      const n = weights.length;
      const rounds = 40_000;
      const hits = new Array(n).fill(0);
      for (let r = 0; r < rounds; r++) {
        const perm = [...Array(n).keys()];
        for (let k = n - 1; k > 0; k--) {
          const j = rng.int(k + 1);
          [perm[k], perm[j]] = [perm[j], perm[k]];
        }
        let s = 0;
        for (const j of perm) {
          s += weights[j];
          if (s >= quota) {
            hits[j]++;
            break;
          }
        }
      }
      hits.forEach((h, i) => {
        const p = shapley(cid, i);
        expect(Math.abs(h / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      });
    }
  });

  it('martingale: the columns average to the chance now, and the shaded share is that chance', () => {
    for (const cid of COMMITTEE_IDS) {
      for (let t = 0; t < 40; t++) {
        const r = randomLive(cid);
        const cols = columns(r);
        expect(shadedShare(cols)).toBeCloseTo(winChance(r), 12);
        const nexts = cols.map((c) => join(r, c.voter));
        const meanCash = nexts.reduce((a, n) => a + cashValue(n), 0) / nexts.length;
        expect(meanCash).toBeCloseTo(cashValue(r), 9);
        cols.forEach((c, k) => expect(c.p).toBeCloseTo(winChance(nexts[k]), 14));
      }
      // At the start the cash-out is RTP for every voter: the choice is EV-neutral.
      COMMITTEES[cid].weights.forEach((_, i) => expect(cashValue(newRound(cid, i))).toBeCloseTo(RTP, 12));
    }
  });

  it('the shaded tip zone is exactly the coalition totals where your joining tips the quota', () => {
    for (const cid of COMMITTEE_IDS) {
      const { weights, quota } = COMMITTEES[cid];
      weights.forEach((w, i) => {
        const z = tipZone(cid, i);
        for (let s = 0; s < quota; s++) expect(s >= z.from && s <= z.to).toBe(s + w >= quota);
      });
    }
  });

  it('a planned action resolves, or stops at a state that is neither certain nor lost', () => {
    for (const cid of COMMITTEE_IDS) {
      for (let t = 0; t < 100; t++) {
        const r = randomLive(cid);
        const joins = plan(r, rng);
        const last = joins[joins.length - 1];
        joins.slice(0, -1).forEach((j) => expect(winChance(j)).toBe(1));
        if (last.status === 'live') {
          expect(winChance(last)).toBeGreaterThan(0);
          expect(winChance(last)).toBeLessThan(1);
        }
        if (last.status === 'won') expect(coalitionSum(cid, last.order)).toBeGreaterThanOrEqual(COMMITTEES[cid].quota);
      }
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(Math.max(...COMMITTEE_IDS.flatMap((c) => COMMITTEES[c].weights.map((_, i) => prizeFor(c, i)))), 9);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
