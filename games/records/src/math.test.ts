import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { LADDER, SKY_H, STRIP, bracket, capHeight, ladderCell, stripSegments } from './geometry';
import manifest from './manifest';
import {
  ITEMS,
  MAX_MULTIPLIER,
  RTP,
  TARGETS,
  VOLATILITY,
  advance,
  countRecords,
  finishShares,
  harmonic,
  headline,
  isRecord,
  nextRecordChance,
  outOfReach,
  prizeFor,
  recordChance,
  runWindow,
  tailTable,
  volatilityOf,
  winChance,
} from './math';

const rng = createRng(seededSource(11));
const within4se = (hits: number, trials: number, p: number) =>
  expect(Math.abs(hits / trials - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / trials) + 1e-9);

/** Left-to-right maxima of a uniformly shuffled queue: the raw process, no ranks involved. */
function recordsInShuffle(n: number) {
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  let best = -1;
  let r = 0;
  for (const v of order) if (v > best) (best = v), r++;
  return r;
}

/** A uniformly random live state (j items seen, r records) reached by actually playing items. */
function randomLiveState(n: number, k: number) {
  for (;;) {
    const stop = 1 + rng.int(n - 1);
    let j = 0;
    let r = 0;
    while (j < stop) {
      j++;
      if (rng.int(j) === j - 1) r++;
    }
    if (r < k && !outOfReach(n, k, j, r)) return { j, r };
  }
}

describe('Records maths', () => {
  it('closed form: P(exactly m records) = c(n, m) / n!, the unsigned Stirling numbers of the first kind', () => {
    for (const n of ITEMS) {
      // c(i+1, m) = i·c(i, m) + c(i, m−1)
      let c: bigint[] = [1n];
      for (let i = 0; i < n; i++) {
        const next = Array<bigint>(c.length + 1).fill(0n);
        c.forEach((v, m) => {
          next[m] += BigInt(i) * v;
          next[m + 1] += v;
        });
        c = next;
      }
      const fact = c.reduce((a, b) => a + b, 0n); // Σ c(n, m) = n!
      const t = tailTable(n)[0];
      for (let m = 1; m <= Math.min(n, 20); m++) {
        const exact = Number((c[m] * 10n ** 30n) / fact) / 1e30;
        const dp = t[m] - t[m + 1];
        expect(Math.abs(dp - exact)).toBeLessThan(1e-12 + 1e-9 * exact);
      }
      // Mean H_n.
      let mean = 0;
      for (let m = 1; m <= n; m++) mean += m * (t[m] - t[m + 1]);
      expect(mean).toBeCloseTo(harmonic(n), 10);
    }
  });

  it('the headline chance matches shuffling the queue and counting records (and permutation cycles: Foata)', () => {
    const trials = 12_000;
    for (const n of ITEMS) {
      const ks = TARGETS[n];
      const sample = Array.from({ length: trials }, () => recordsInShuffle(n));
      for (const k of [ks[1], ks[Math.floor(ks.length / 2)], ks[ks.length - 2]]) {
        within4se(sample.filter((r) => r >= k).length, trials, headline(n, k));
      }
    }
    // Cycles of a random permutation have the same law as records.
    const n = 20;
    const cyc = Array.from({ length: trials }, () => {
      const perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
      const seen = new Uint8Array(n);
      let cycles = 0;
      for (let i = 0; i < n; i++) {
        if (seen[i]) continue;
        cycles++;
        for (let x = i; !seen[x]; x = perm[x]) seen[x] = 1;
      }
      return cycles;
    });
    for (const k of [3, 5, 7]) within4se(cyc.filter((c) => c >= k).length, trials, headline(n, k));
  });

  it('every offered setting has a headline chance between 0.1% and 95%, and volatility spans 25:1', () => {
    for (const n of ITEMS) {
      for (const k of TARGETS[n]) {
        expect(headline(n, k)).toBeGreaterThanOrEqual(0.001);
        expect(headline(n, k)).toBeLessThanOrEqual(0.95 + 1e-12);
      }
    }
    const ps = Object.values(VOLATILITY).map(({ n, k }) => headline(n, k));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const [level, { n, k }] of Object.entries(VOLATILITY)) expect(volatilityOf(n, k)).toBe(level);
  });

  it('martingale: both moves are fair at random reachable states (exact to 1e-12)', () => {
    for (const n of ITEMS) {
      for (const k of TARGETS[n]) {
        for (let trial = 0; trial < 25; trial++) {
          const { j, r } = randomLiveState(n, k);
          const now = winChance(n, k, j, r);
          // Next item: a record with chance 1/(j+1).
          const q = recordChance(j + 1);
          expect(q * winChance(n, k, j + 1, r + 1) + (1 - q) * winChance(n, k, j + 1, r)).toBeCloseTo(now, 12);
          // Run to the next record: it lands on item m with chance j/(m(m−1)); no record at all leaves 0.
          let after = 0;
          let mass = 0;
          for (let m = j + 1; m <= n; m++) {
            after += nextRecordChance(j, m) * winChance(n, k, m, r + 1);
            mass += nextRecordChance(j, m);
          }
          expect(mass + j / n).toBeCloseTo(1, 12);
          expect(after).toBeCloseTo(now, 12);
          // So the cash-out prize × P is a martingale too.
          const prize = prizeFor(n, k);
          expect(prize * after).toBeCloseTo(prize * now, 9);
        }
      }
    }
    // At the start the cash-out is exactly RTP.
    for (const n of ITEMS) for (const k of TARGETS[n]) expect(prizeFor(n, k) * winChance(n, k, 1, 1)).toBeCloseTo(RTP, 12);
  });

  it("the game's moves follow the priced law: item t is a record 1 time in t; runs land on m with chance j/(m(m−1))", () => {
    for (const t of [2, 5, 13, 40]) {
      const trials = 20_000;
      let hits = 0;
      for (let i = 0; i < trials; i++) {
        const [rank] = advance(100, 12, t - 1, 1, 'item', rng);
        if (isRecord(rank, t)) hits++;
      }
      within4se(hits, trials, recordChance(t));
    }
    // A run from j = 4 in a 20-item queue needing 1 more record: where does it stop?
    const n = 20;
    const j = 4;
    const trials = 30_000;
    const at = new Array(n + 1).fill(0);
    let none = 0;
    for (let i = 0; i < trials; i++) {
      const ranks = advance(n, 2, j, 1, 'run', rng);
      const last = j + ranks.length;
      if (isRecord(ranks[ranks.length - 1], last)) at[last]++;
      else none++;
      // A run reveals at most one record, and only as its last item.
      expect(ranks.filter((rank, x) => isRecord(rank, j + x + 1)).length).toBeLessThanOrEqual(1);
      expect(countRecords([1, ...ranks.map(() => 1)])).toBe(1);
    }
    within4se(none, trials, j / n);
    for (const m of [5, 6, 9, 15, 20]) within4se(at[m], trials, nextRecordChance(j, m));
  });

  it('what is drawn as the odds is the true risk: ladder slot, caps, run bracket and finish strip', () => {
    // Ladder: the pink top slot of item t is 1/t of the ladder, and the slots tile it exactly.
    const ladderH = LADDER.bottom - LADDER.top;
    for (let t = 1; t <= 100; t++) {
      const top = ladderCell(t, t);
      expect(top.y).toBeCloseTo(LADDER.top, 9);
      expect(top.h / ladderH).toBeCloseTo(recordChance(t), 12);
      expect(ladderCell(t, 1).y + ladderCell(t, 1).h).toBeCloseTo(LADDER.bottom, 9);
      expect(capHeight(t) / SKY_H).toBeCloseTo(recordChance(t), 12);
    }
    for (const n of ITEMS) {
      for (const k of [TARGETS[n][1], TARGETS[n][TARGETS[n].length - 1]]) {
        for (let trial = 0; trial < 4; trial++) {
          const { j, r } = randomLiveState(n, k);
          // Run bracket: green share = chance the next record lands in time, checked by playing runs.
          const w = runWindow(n, k, j, r)!;
          const b = bracket(n, w);
          const green = (b.xUntil - b.xSeen) / (b.xUntil - b.x0);
          expect(green).toBeCloseTo(w.chance, 12);
          const trials = 6000;
          let inTime = 0;
          for (let i = 0; i < trials; i++) {
            const ranks = advance(n, k, j, r, 'run', rng);
            if (isRecord(ranks[ranks.length - 1], j + ranks.length)) inTime++;
          }
          within4se(inTime, trials, w.chance);
          // Finish strip: the shares tile the strip, the green share is the win chance, and they match
          // the final record counts of the queue played out item by item.
          const shares = finishShares(n, k, j, r);
          const segs = stripSegments(shares);
          const last = segs[segs.length - 1];
          expect(last.x + last.w).toBeCloseTo(STRIP.x1, 9);
          expect(last.win).toBe(true);
          expect(last.w / (STRIP.x1 - STRIP.x0)).toBeCloseTo(winChance(n, k, j, r), 12);
          const finals = new Map<number, number>();
          for (let i = 0; i < trials; i++) {
            let rec = r;
            for (let t = j + 1; t <= n; t++) if (rng.int(t) === t - 1) rec++;
            const c = Math.min(rec, k);
            finals.set(c, (finals.get(c) ?? 0) + 1);
          }
          for (const s of shares) within4se(finals.get(s.count) ?? 0, trials, s.p);
        }
      }
    }
  });

  it('optional stopping, exactly: any state-based pace and stopping rule is worth RTP (no simulation)', () => {
    type Rule = (j: number, r: number, p: number) => 'stop' | 'item' | 'run';
    const rules: Rule[] = [
      () => 'run',
      () => 'item',
      (j, r) => ((j + r) % 3 === 0 ? 'item' : 'run'),
      (_j, r, p) => (p < 0.5 * winChance(50, 6, 1, 1) ? 'stop' : r % 2 ? 'run' : 'item'),
      (j, _r, p) => (p > 0.6 || j > 30 ? 'stop' : 'run'),
    ];
    for (const [n, k] of [[20, 5], [50, 6], [100, 9], [10, 7]] as const) {
      const prize = prizeFor(n, k);
      for (const rule of rules) {
        const memo = new Map<number, number>();
        // Expected final payout from a live state, following `rule` exactly.
        const value = (j: number, r: number): number => {
          if (r >= k) return prize;
          if (outOfReach(n, k, j, r)) return 0;
          const key = j * 1000 + r;
          const hit = memo.get(key);
          if (hit !== undefined) return hit;
          const p = winChance(n, k, j, r);
          const act = j === 0 ? 'item' : rule(j, r, p);
          let v: number;
          if (act === 'stop') v = prize * p;
          else if (act === 'item') v = recordChance(j + 1) * value(j + 1, r + 1) + (1 - recordChance(j + 1)) * value(j + 1, r);
          else {
            // A run stops at the next record m, or loses once the target is out of reach.
            v = 0;
            for (let m = j + 1; m <= n; m++) if (!outOfReach(n, k, m - 1, r)) v += nextRecordChance(j, m) * value(m, r + 1);
          }
          memo.set(key, v);
          return v;
        };
        expect(value(0, 0)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('simulated RTP matches the manifest under sampled paces and stopping rules', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
