// Fairness audit: can any way of playing Video Poker beat its stated RTP?
//
// Video Poker is a skill game with one decision: which of the 32 holds to
// draw with. The target is that OPTIMAL holds return each paytable's stated
// RTP and nothing does better. The value of a dealt hand is
// V*(deal) = max over holds of E[pay | hold] (solve().bestValue); leaving
// mid-hand settles at exactly that (Game.tsx sets the ticket's fair value to
// bestValue at the deal, and to the drawn result the moment the draw is made,
// before any animation). The paytable is locked while a hand is live, the
// replacement cards are drawn only when Draw is pressed, and the face-down
// slots carry no card, so nothing about the draw can be seen or dodged.
//
// Checks:
//   - deal() and draw() are exactly uniform (enumerating the integers they
//     ask the rng for);
//   - martingale: for 40+ deals on every paytable, each hold's value equals a
//     brute-force average over every possible draw, and V* is their max, so
//     E[final | any hold] ≤ V* with equality for the best hold;
//   - strategies, evaluated exactly per deal on thousands of random deals:
//     (a) draw with the best hold when its paying chance is ≥ 0.8, else leave
//     (paid V*); (b) leave whenever V* > 1, else draw; (c) draw with the best
//     hold; (d) the best hold with random tie-breaks, and the variance-seeking
//     hold (most royal / straight-flush chance). (a)–(c) are worth exactly V*
//     on every single deal, so their RTP is exactly the optimal RTP that
//     math.test.ts derives over all 2,598,960 deals; (d) is never worth more.
//   - realized play: every eval config's simulation lands within 4 SE.
//     (The 200k-round runs per table and strategy live in the audit's scratch
//     script; at ~0.3 ms per hand they don't fit in a unit test.)

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  NCAT,
  PAYTABLES,
  PAYTABLE_IDS,
  ROYAL,
  STRAIGHT_FLUSH,
  analyse,
  categoryOf,
  deal,
  draw,
  holdDist,
  holdValue,
  parseHand,
  payingChance,
  popcount5,
  solve,
  warmUp,
  type Card,
} from './math';

/** Every outcome of fn over the integers it asks the rng for, each branch equally likely within its n. */
function enumerateInts<T>(fn: (rng: Rng) => T): { p: number; out: T }[] {
  const res: { p: number; out: T }[] = [];
  const NEED = {};
  const explore = (prefix: number[], p: number) => {
    let i = 0;
    let need = 0;
    const rng: Rng = {
      next: () => {
        throw new Error('draw and deal should only use rng.int');
      },
      int: (n: number) => {
        if (i < prefix.length) return prefix[i++];
        need = n;
        throw NEED;
      },
      shuffle: () => {
        throw new Error('unused');
      },
    };
    try {
      res.push({ p, out: fn(rng) });
    } catch (e) {
      if (e !== NEED) throw e;
      for (let k = 0; k < need; k++) explore([...prefix, k], p / need);
    }
  };
  explore([], 1);
  return res;
}

/** The final-hand histogram of a hold by brute force over every set of replacement cards. */
function bruteCounts(hand: Card[], hold: number): { counts: number[]; n: number } {
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!hand.includes(c)) unseen.push(c);
  const slots = [0, 1, 2, 3, 4].filter((i) => !(hold & (1 << i)));
  const cur = hand.slice();
  const counts = new Array(NCAT).fill(0);
  let n = 0;
  const rec = (s: number, from: number) => {
    if (s === slots.length) {
      counts[categoryOf(cur)]++;
      n++;
      return;
    }
    for (let j = from; j < unseen.length; j++) {
      cur[slots[s]] = unseen[j];
      rec(s + 1, j + 1);
    }
  };
  rec(0, 0);
  return { counts, n };
}

const EDGE_DEALS = ['As Ks Qs Js 10s', 'As Ks Qs Js 4d', 'Ah Ad Ac As 3c', '2h 2d 2c 2s Ah', 'Jh Jd 7c 7s 2d', '2h 5d 9c Js 7d', '10h Jh Qh Kh 9h', '3c 4d 5h 6s 9c'].map(parseHand);

describe('Video Poker fairness', () => {
  it('draw() picks every set of replacement cards equally often, never a dealt card; deal() is a uniform partial shuffle', () => {
    const rng = createRng(seededSource(3));
    for (let trial = 0; trial < 3; trial++) {
      const hand = deal(rng);
      for (const hold of [0b11110, 0b10101, 0b00011]) {
        const k = 5 - popcount5(hold);
        const fact = [1, 1, 2, 6][k];
        const seen = new Map<string, number>();
        let bad = 0;
        for (const { out } of enumerateInts((r) => draw(hand, hold, r))) {
          const repl = [0, 1, 2, 3, 4].filter((i) => !(hold & (1 << i))).map((i) => out[i]);
          if (repl.some((c) => hand.includes(c))) bad++;
          if ([0, 1, 2, 3, 4].some((i) => hold & (1 << i) && out[i] !== hand[i])) bad++;
          const key = repl.slice().sort((a, b) => a - b).join(',');
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        expect(bad).toBe(0);
        const combos = [1, 47, 1081, 16215][k];
        expect(seen.size).toBe(combos);
        expect([...seen.values()].every((v) => v === fact)).toBe(true);
      }
    }
    // deal(): the first three positions over every integer they can draw (the last two fixed) are every ordered triple once.
    const triples = new Set<number>();
    let calls = 0;
    let dup = 0;
    const prefix: Rng = { next: () => 0, int: () => 0, shuffle: (x) => x.slice() };
    for (let a = 0; a < 52; a++)
      for (let b = 0; b < 51; b++)
        for (let c = 0; c < 50; c++) {
          const ints = [a, b, c, 0, 0];
          let i = 0;
          const h = deal({ ...prefix, int: () => ints[i++] });
          calls++;
          if (new Set(h).size !== 5) dup++;
          triples.add((h[0] * 52 + h[1]) * 52 + h[2]);
        }
    expect(dup).toBe(0);
    expect(triples.size).toBe(calls);
  });

  it('martingale: every hold is worth its brute-force average over all draws; V* = the best of them is what leaving pays', () => {
    warmUp();
    const rng = createRng(seededSource(5));
    const deals = [...EDGE_DEALS];
    while (deals.length < 44) deals.push(deal(rng));
    deals.forEach((hand, di) => {
      const a = analyse(hand);
      // Brute force every hold with ≤ 3 cards replaced; 4 replaced on three deals; all 5 on one.
      const brute = new Map<number, { counts: number[]; n: number }>();
      for (let m = 0; m < 32; m++) {
        const k = 5 - popcount5(m);
        if (k <= 3 || (k === 4 && di < 3) || (k === 5 && di === 8)) brute.set(m, bruteCounts(hand, m));
      }
      for (const id of PAYTABLE_IDS) {
        const pays = PAYTABLES[id].pays;
        const sol = solve(a, pays);
        let max = -1;
        for (let m = 0; m < 32; m++) {
          const v = holdValue(a, m, pays);
          max = Math.max(max, v);
          expect(v).toBeLessThanOrEqual(sol.bestValue + 1e-12);
          const b = brute.get(m);
          if (b) expect(Math.abs(v - b.counts.reduce((s, x, c) => s + x * pays[c], 0) / b.n)).toBeLessThan(1e-12);
        }
        expect(sol.bestValue).toBe(max);
        expect(holdValue(a, sol.best, pays)).toBe(sol.bestValue);
        for (const m of sol.ties) expect(Math.abs(holdValue(a, m, pays) - sol.bestValue)).toBeLessThan(1e-9);
        // The paying chance shown on screen is the draw distribution's paying mass.
        const d = holdDist(a, sol.best);
        expect(Math.abs(d.reduce((s, p) => s + p, 0) - 1)).toBeLessThan(1e-12);
        expect(Math.abs(payingChance(a, sol.best, pays) - d.reduce((s, p, c) => s + (pays[c] > 0 ? p : 0), 0))).toBeLessThan(1e-12);
      }
    });
  }, 300_000);

  it('strategies (a)–(d), exactly per deal on 2,500 random deals per table: none is ever worth more than V*', () => {
    const rng = createRng(seededSource(7));
    const n = 2500;
    const sums: Record<string, Record<string, number>> = {};
    for (const id of PAYTABLE_IDS) sums[id] = { a: 0, b: 0, c: 0, d: 0, dVar: 0, vStar: 0 };
    for (let k = 0; k < n; k++) {
      const hand = deal(rng);
      const a = analyse(hand);
      for (const id of PAYTABLE_IDS) {
        const pays = PAYTABLES[id].pays;
        const sol = solve(a, pays);
        const V = sol.bestValue;
        const drawBest = holdValue(a, sol.best, pays);
        const ea = payingChance(a, sol.best, pays) >= 0.8 ? drawBest : V; // (a)
        const eb = V > 1 ? V : drawBest; // (b)
        const ec = drawBest; // (c)
        const ed = holdValue(a, sol.ties[rng.int(sol.ties.length)], pays); // (d) random tie-break
        // (d') the variance-seeking hold: the most royal + straight-flush chance.
        let mVar = 0;
        let pVar = -1;
        for (let m = 0; m < 32; m++) {
          const dist = holdDist(a, m);
          const top = dist[ROYAL] + dist[STRAIGHT_FLUSH];
          if (top > pVar + 1e-15) [pVar, mVar] = [top, m];
        }
        const eVar = holdValue(a, mVar, pays);
        for (const e of [ea, eb, ec, ed]) expect(Math.abs(e - V)).toBeLessThan(1e-9);
        expect(eVar).toBeLessThanOrEqual(V + 1e-12);
        const s = sums[id];
        s.a += ea;
        s.b += eb;
        s.c += ec;
        s.d += ed;
        s.dVar += eVar;
        s.vStar += V;
      }
    }
    for (const id of PAYTABLE_IDS) expect(sums[id].dVar).toBeLessThan(sums[id].vStar);
  }, 300_000);

  it('(c) realized play through the eval matches each table within 4 SE', () => {
    const rng = createRng(seededSource(9));
    const n = 4000;
    for (const c of evalSpec.configs) {
      let s = 0;
      let s2 = 0;
      for (let k = 0; k < n; k++) {
        const m = evalSpec.playRound(c.params, rng).multiplier;
        s += m;
        s2 += m * m;
      }
      const mean = s / n;
      const se = Math.sqrt(Math.max(0, s2 / n - mean * mean) / n);
      // A royal (800×) in 4,000 hands would swamp the SE; the bound uses the table's true sd instead.
      const pt = PAYTABLES[(c.params as { table: keyof typeof PAYTABLES }).table];
      const sd = Math.sqrt(pt.dist.reduce((a, p, cat) => a + p * pt.pays[cat] ** 2, 0) - pt.rtp ** 2);
      expect(Math.abs(mean - c.rtp!)).toBeLessThan(4 * Math.max(se, sd / Math.sqrt(n)));
    }
  }, 300_000);
});
