import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BALLOTS,
  CANDS,
  ELECTIONS,
  MAX_MULTIPLIER,
  PICKS,
  RANKINGS,
  RTP,
  VOTERS,
  ZERO,
  addBallot,
  cashValue,
  count,
  electionChance,
  finalChances,
  newSeries,
  nextChances,
  nextLoss,
  perElection,
  plan,
  prizeFor,
  shareBar,
  winChance,
  type Cand,
  type Pick,
  type Series,
} from './math';

const rng = createRng(seededSource(11));

/** The result straight from the rankings, without the margin vectors. */
function rawResult(rankings: (readonly Cand[])[]): Pick {
  const beats = (x: Cand, y: Cand) => rankings.filter((r) => r.indexOf(x) < r.indexOf(y)).length * 2 > rankings.length;
  for (const c of CANDS) if (CANDS.every((o) => o === c || beats(c, o))) return c;
  return 'cycle';
}

/** A random reachable live state (some elections won, some ballots counted). */
function randomState(): Series {
  const pick = PICKS[rng.int(4)];
  const voters = VOTERS[rng.int(VOTERS.length)];
  const elections = ELECTIONS[rng.int(3)];
  let s = newSeries(pick, voters, elections);
  const moves = rng.int(voters * elections);
  for (let i = 0; i < moves && s.status === 'live'; i++) {
    const c = count(s, rng.int(6));
    if (c.next.status !== 'live') break;
    s = c.next;
  }
  return s;
}

describe('Condorcet maths', () => {
  it('each ballot moves the margins by its pairwise preferences, and is never cyclic', () => {
    RANKINGS.forEach((rk, b) => {
      expect(BALLOTS[b]).toEqual([rk.indexOf('A') < rk.indexOf('B') ? 1 : -1, rk.indexOf('B') < rk.indexOf('C') ? 1 : -1, rk.indexOf('C') < rk.indexOf('A') ? 1 : -1]);
      expect(Math.abs(BALLOTS[b][0] + BALLOTS[b][1] + BALLOTS[b][2])).toBe(1);
    });
  });

  it('exact odds equal full enumeration for 3 and 5 voters (cycle 1/18 and 5/72)', () => {
    for (const n of [3, 5]) {
      const tally: Record<Pick, number> = { A: 0, B: 0, C: 0, cycle: 0 };
      const total = 6 ** n;
      for (let code = 0; code < total; code++) {
        const rs: (readonly Cand[])[] = [];
        for (let i = 0, c = code; i < n; i++, c = Math.floor(c / 6)) rs.push(RANKINGS[c % 6]);
        tally[rawResult(rs)]++;
      }
      const c = finalChances(ZERO, n);
      for (const p of PICKS) expect(c[p]).toBeCloseTo(tally[p] / total, 13);
    }
    expect(perElection('cycle', 3)).toBeCloseTo(1 / 18, 14);
    expect(perElection('cycle', 5)).toBeCloseTo(5 / 72, 14);
  });

  it('the cycle chance rises with n towards Guilbaud’s limit 8.77%', () => {
    const limit = 0.25 - (3 / (2 * Math.PI)) * Math.asin(1 / 3);
    let prev = 0;
    for (const n of VOTERS) {
      const p = perElection('cycle', n);
      expect(p).toBeGreaterThan(prev);
      expect(p).toBeLessThan(limit);
      prev = p;
    }
    expect(limit - prev).toBeLessThan(0.004);
    for (const n of VOTERS) for (const c of CANDS) expect(perElection(c, n)).toBeCloseTo((1 - perElection('cycle', n)) / 3, 12);
  });

  it('the exact odds match a direct simulation of random voters', () => {
    for (const n of VOTERS) {
      const rounds = 20_000;
      const tally: Record<Pick, number> = { A: 0, B: 0, C: 0, cycle: 0 };
      for (let r = 0; r < rounds; r++) tally[rawResult(Array.from({ length: n }, () => RANKINGS[rng.int(6)]))]++;
      for (const pick of PICKS) {
        const p = perElection(pick, n);
        expect(Math.abs(tally[pick] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
      }
    }
  });

  it('mid-count odds match simulation of the remaining ballots', () => {
    for (let t = 0; t < 6; t++) {
      const s = randomState();
      const left = s.voters - s.ballots.length;
      const rounds = 4000;
      const tally: Record<Pick, number> = { A: 0, B: 0, C: 0, cycle: 0 };
      for (let r = 0; r < rounds; r++) {
        let m = s.margins;
        for (let i = 0; i < left; i++) m = addBallot(m, rng.int(6));
        const res = finalChances(m, 0);
        tally[PICKS.find((p) => res[p] === 1)!]++;
      }
      const c = finalChances(s.margins, left);
      for (const pick of PICKS) expect(Math.abs(tally[pick] / rounds - c[pick])).toBeLessThan(4 * Math.sqrt((c[pick] * (1 - c[pick])) / rounds) + 1e-9);
    }
  });

  it('every ballot is a fair bet: the cash-out is the average over the six next ballots', () => {
    for (let t = 0; t < 400; t++) {
      const s = randomState();
      const after = BALLOTS.map((_, b) => cashValue(count(s, b).next));
      const mean = after.reduce((a, b) => a + b, 0) / 6;
      expect(Math.abs(mean - cashValue(s))).toBeLessThan(1e-9 * Math.max(1, cashValue(s)));
    }
    for (const p of PICKS) for (const n of VOTERS) for (const k of ELECTIONS) expect(cashValue(newSeries(p, n, k))).toBeCloseTo(RTP, 12);
  });

  it('decided elections stop at an unchanged value, and impossible results end the round', () => {
    let decided = 0;
    let dead = 0;
    for (let t = 0; t < 3000; t++) {
      const s = randomState();
      if (s.status !== 'live') continue;
      for (let b = 0; b < 6; b++) {
        const c = count(s, b);
        const p = finalChances(c.margins, s.voters - c.ballots.length)[s.pick];
        if (p === 0) {
          dead++;
          expect(c.next.status).toBe('lost');
          expect(c.ended).toBe(true);
        } else if (p === 1) {
          decided++;
          expect(c.ended).toBe(true);
          expect(c.next.won).toBe(s.won + 1);
          // Counting the rest could not have changed the result.
          for (const q of PICKS) if (q !== s.pick) expect(finalChances(c.margins, s.voters - c.ballots.length)[q]).toBe(0);
        } else expect(c.ended).toBe(false);
      }
    }
    expect(decided).toBeGreaterThan(0);
    expect(dead).toBeGreaterThan(0);
  });

  it('what the board draws is the true chance: the bar splits it, the six tiles average to it', () => {
    for (let t = 0; t < 300; t++) {
      const s = randomState();
      const c = finalChances(s.margins, s.voters - s.ballots.length);
      const bar = shareBar(c);
      expect(bar.map((b) => b.pick)).toEqual(['A', 'B', 'C', 'cycle']);
      for (const b of bar) expect(b.to - b.from).toBeCloseTo(c[b.pick], 12);
      expect(bar[3].to).toBeCloseTo(1, 12);
      const tiles = nextChances(s);
      expect(tiles.reduce((a, b) => a + b, 0) / 6).toBeCloseTo(electionChance(s), 12);
      expect(nextLoss(s)).toBe(tiles.filter((p) => p === 0).length / 6);
      expect(winChance(s)).toBeCloseTo(electionChance(s) * perElection(s.pick, s.voters) ** (s.elections - s.won - 1), 14);
    }
  });

  it('counting the rest finishes exactly one election', () => {
    for (let t = 0; t < 200; t++) {
      const s = randomState();
      const counts = plan(s, 'rest', rng);
      expect(counts.slice(0, -1).every((c) => !c.ended)).toBe(true);
      const last = counts[counts.length - 1];
      expect(last.ended).toBe(true);
      expect(last.ballots.length + last.skipped).toBe(s.voters);
    }
  });

  it('simulated RTP matches the manifest under sampled strategies, and no payout exceeds maxMultiplier', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeCloseTo(prizeFor('cycle', 5, 3), 9);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
