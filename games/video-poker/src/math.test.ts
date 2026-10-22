import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DRAWS,
  FLUSH,
  FULL_HOUSE,
  JACKS,
  MAX_MULTIPLIER,
  NCAT,
  NOTHING,
  PAYTABLES,
  PAYTABLE_IDS,
  QUADS,
  QUADS_ACES,
  QUADS_ACES_KICKER,
  QUADS_LOW,
  QUADS_LOW_KICKER,
  ROYAL,
  RTP,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
  analyse,
  category5,
  categoryOf,
  deal,
  draw,
  enumerateOptimal,
  holdCounts,
  holdValue,
  parseHand,
  payingChance,
  playOptimal,
  popcount5,
  scoringMask,
  solve,
  type Card,
} from './math';

const classic = PAYTABLES.classic;

/** Brute force: every draw for a hold, by direct enumeration of the 47 unseen cards. */
function bruteCounts(hand: Card[], hold: number): number[] {
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!hand.includes(c)) unseen.push(c);
  const slots = [0, 1, 2, 3, 4].filter((i) => !(hold & (1 << i)));
  const counts = new Array(NCAT).fill(0);
  const cur = hand.slice();
  const rec = (s: number, from: number) => {
    if (s === slots.length) {
      counts[categoryOf(cur)]++;
      return;
    }
    for (let j = from; j < unseen.length; j++) {
      cur[slots[s]] = unseen[j];
      rec(s + 1, j + 1);
    }
  };
  rec(0, 0);
  return counts;
}

describe('Video Poker hand evaluator', () => {
  it('classifies all 2,598,960 hands into the textbook counts', () => {
    const n = new Array(NCAT).fill(0);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++) for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) n[category5(a, b, c, d, e)]++;
    expect(n[ROYAL]).toBe(4);
    expect(n[STRAIGHT_FLUSH]).toBe(36);
    expect(n[QUADS] + n[QUADS_LOW] + n[QUADS_LOW_KICKER] + n[QUADS_ACES] + n[QUADS_ACES_KICKER]).toBe(624);
    expect([n[QUADS_ACES_KICKER], n[QUADS_ACES], n[QUADS_LOW_KICKER], n[QUADS_LOW], n[QUADS]]).toEqual([12, 36, 36, 108, 432]);
    expect(n[FULL_HOUSE]).toBe(3744);
    expect(n[FLUSH]).toBe(5108);
    expect(n[STRAIGHT]).toBe(10200);
    expect(n[TRIPS]).toBe(54912);
    expect(n[TWO_PAIR]).toBe(123552);
    expect(n[JACKS]).toBe(337920); // 4 ranks × C(4,2) × C(12,3) × 4³
    expect(n[NOTHING]).toBe(2598960 - 4 - 36 - 624 - 3744 - 5108 - 10200 - 54912 - 123552 - 337920);
  });

  it('handles the edge cases: wheel, ace-high straight, tens pair, kickers', () => {
    expect(categoryOf(parseHand('As 2d 3h 4c 5s'))).toBe(STRAIGHT);
    expect(categoryOf(parseHand('10d Jd Qd Kd Ad'))).toBe(ROYAL);
    expect(categoryOf(parseHand('9d 10d Jd Qd Kd'))).toBe(STRAIGHT_FLUSH);
    expect(categoryOf(parseHand('Qs Kd Ah 2c 3s'))).toBe(NOTHING); // no wrap-around
    expect(categoryOf(parseHand('10s 10d 4h 7c Ks'))).toBe(NOTHING);
    expect(categoryOf(parseHand('Js Jd 4h 7c Ks'))).toBe(JACKS);
    expect(categoryOf(parseHand('As Ad Ah Ac 3s'))).toBe(QUADS_ACES_KICKER);
    expect(categoryOf(parseHand('As Ad Ah Ac 5s'))).toBe(QUADS_ACES);
    expect(categoryOf(parseHand('3s 3d 3h 3c As'))).toBe(QUADS_LOW_KICKER);
    expect(categoryOf(parseHand('3s 3d 3h 3c 2s'))).toBe(QUADS_LOW_KICKER);
    expect(categoryOf(parseHand('3s 3d 3h 3c 9s'))).toBe(QUADS_LOW);
    expect(categoryOf(parseHand('9s 9d 9h 9c 2s'))).toBe(QUADS);
    expect(categoryOf(parseHand('9s 9d 9h 2c 2s'))).toBe(FULL_HOUSE);
    expect(scoringMask(parseHand('Js 4d Jh 7c Ks'), JACKS)).toBe(0b00101);
    expect(scoringMask(parseHand('9s 9d 9h 9c 2s'), QUADS)).toBe(0b01111);
  });
});

describe('Video Poker exact hold solver', () => {
  it('every hold of several hands matches brute-force enumeration of the draws, count for count', () => {
    const hands = ['Ah Kh Qh Jh 2c', '2c 2d 7h 9s Kd', 'Kh Kd 7s 7c 2h', '3s 4d 9h 10c Qs', 'As Ad Ah Ac 3s'].map(parseHand);
    const rng = createRng(seededSource(11));
    hands.push(deal(rng), deal(rng));
    for (const hand of hands) {
      const a = analyse(hand);
      for (let mask = 0; mask < 32; mask++) {
        // Discard-all and single-card holds are the big enumerations; check them on two hands.
        if (popcount5(mask) <= 1 && hand !== hands[0] && hand !== hands[3]) continue;
        expect(Array.from(holdCounts(a, mask))).toEqual(bruteCounts(hand, mask));
      }
    }
  });

  it('every hold accounts for exactly C(47, 5 − held) draws', () => {
    const rng = createRng(seededSource(2));
    for (let t = 0; t < 200; t++) {
      const a = analyse(deal(rng));
      for (let mask = 0; mask < 32; mask++) expect(holdCounts(a, mask).reduce((s, x) => s + x, 0)).toBe(DRAWS[popcount5(mask)]);
    }
  });

  it('textbook holds: pat royal, 4 to a royal over a pat flush, two pair, a low pair', () => {
    const royal = solve(analyse(parseHand('As Ks Qs Js 10s')), classic.pays);
    expect(royal.best).toBe(31);
    expect(royal.bestValue).toBe(800);

    const four = analyse(parseHand('Ah Kh Qh Jh 2h'));
    const s = solve(four, classic.pays);
    expect(s.best).toBe(0b01111);
    expect(holdValue(four, 31, classic.pays)).toBe(6);
    // 47 unseen: 1 royal, 7 other hearts (flush), 3 tens (straight), 12 non-heart J–A (jacks or better).
    expect(s.bestValue).toBeCloseTo((800 + 7 * 6 + 3 * 4 + 12 * 1) / 47, 12);

    const twoPair = solve(analyse(parseHand('Kh Kd 7s 7c 2h')), classic.pays);
    expect(twoPair.best).toBe(0b01111);
    expect(twoPair.bestValue).toBeCloseTo((4 * 9 + 43 * 2) / 47, 12);

    const lowPair = solve(analyse(parseHand('2c 2d 7h 9s Kd')), classic.pays);
    expect(lowPair.best).toBe(0b00011);
  });

  it('the paying-hand chance on screen equals a direct simulation of the draw (4 SE)', () => {
    const rng = createRng(seededSource(7));
    const hand = parseHand('Qh Jh 10s 4c 4d');
    const a = analyse(hand);
    for (const hold of [0b00011, 0b11000, 0b00111, 0]) {
      const p = payingChance(a, hold, classic.pays);
      const n = 40_000;
      let hits = 0;
      for (let i = 0; i < n; i++) if (classic.pays[categoryOf(draw(hand, hold, rng))] > 0) hits++;
      expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('solving a hand stays well under 50 ms', () => {
    const rng = createRng(seededSource(4));
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) solve(analyse(deal(rng)), classic.pays);
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});

describe('Video Poker exact RTP (all 2,598,960 deals)', () => {
  it('optimal play returns the stated RTP and final-hand distribution on every table', () => {
    const res = enumerateOptimal(PAYTABLE_IDS.map((id) => PAYTABLES[id].pays));
    PAYTABLE_IDS.forEach((id, i) => {
      const pt = PAYTABLES[id];
      expect(res[i].rtp).toBeCloseTo(pt.rtp, 12);
      res[i].dist.forEach((p, c) => expect(p).toBeCloseTo(pt.dist[c], 11));
      expect(pt.dist.reduce((s, p, c) => s + p * pt.pays[c], 0)).toBeCloseTo(pt.rtp, 10);
    });
    // The published optimal-play figures.
    expect(PAYTABLES.classic.rtp).toBeCloseTo(0.995439, 6);
    expect(PAYTABLES.bonus.rtp).toBeCloseTo(0.99166, 5);
    expect(PAYTABLES.double.rtp).toBeCloseTo(0.991065, 6);
    expect(PAYTABLES.kicker.rtp).toBeCloseTo(0.989808, 6);
    expect(manifest.rtp).toBe(RTP);
    expect(RTP).toBe(PAYTABLES.classic.rtp);
  }, 30_000);
});

describe('Video Poker paytables and play', () => {
  it('each row pays one amount, every category has a row, pays climb from jacks to quads, and the royal is the 800× max', () => {
    for (const id of PAYTABLE_IDS) {
      const pt = PAYTABLES[id];
      const seen = new Set<number>();
      for (const row of pt.rows) {
        const pays = row.cats.map((c) => pt.pays[c]);
        expect(new Set(pays).size).toBe(1);
        for (const c of row.cats) seen.add(c);
      }
      // Jacks ≤ two pair < trips < straight < flush < full house < every four of a kind; kickers never pay less.
      for (let c = TWO_PAIR; c <= FULL_HOUSE; c++) expect(pt.pays[c]).toBeGreaterThanOrEqual(pt.pays[c - 1]);
      for (const q of [QUADS, QUADS_LOW, QUADS_LOW_KICKER, QUADS_ACES, QUADS_ACES_KICKER]) expect(pt.pays[q]).toBeGreaterThan(pt.pays[FULL_HOUSE]);
      expect(pt.pays[QUADS_LOW_KICKER]).toBeGreaterThanOrEqual(pt.pays[QUADS_LOW]);
      expect(pt.pays[QUADS_ACES_KICKER]).toBeGreaterThanOrEqual(pt.pays[QUADS_ACES]);
      expect(pt.pays[QUADS_ACES]).toBeGreaterThanOrEqual(pt.pays[QUADS_LOW]);
      expect(pt.pays[QUADS_LOW]).toBeGreaterThanOrEqual(pt.pays[QUADS]);
      expect(pt.pays[ROYAL]).toBe(MAX_MULTIPLIER);
      expect(pt.rows[0].cats).toEqual([ROYAL]);
      expect(seen.size).toBe(NCAT - 1);
      expect(seen.has(NOTHING)).toBe(false);
      expect(pt.pays[NOTHING]).toBe(0);
      expect(Math.max(...pt.pays)).toBe(MAX_MULTIPLIER);
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('volatility rises with the table: classic < bonus < double < kicker', () => {
    const sd = PAYTABLE_IDS.map((id) => {
      const pt = PAYTABLES[id];
      const m2 = pt.dist.reduce((s, p, c) => s + p * pt.pays[c] ** 2, 0);
      return Math.sqrt(m2 - pt.rtp ** 2);
    });
    for (let i = 1; i < sd.length; i++) expect(sd[i]).toBeGreaterThan(sd[i - 1]);
  });

  it('an Auto hand resolves once, keeps held cards in place and pays the final hand', () => {
    const rng = createRng(seededSource(9));
    for (let i = 0; i < 2000; i++) {
      const pt = PAYTABLES[PAYTABLE_IDS[i % 4]];
      const h = playOptimal(pt, rng, 'random');
      expect(new Set(h.dealt).size).toBe(5);
      expect(new Set(h.final).size).toBe(5);
      for (let k = 0; k < 5; k++) {
        if (h.hold & (1 << k)) expect(h.final[k]).toBe(h.dealt[k]);
        else expect(h.dealt).not.toContain(h.final[k]);
      }
      expect(h.multiplier).toBe(pt.pays[categoryOf(h.final)]);
      const sol = solve(analyse(h.dealt), pt.pays);
      expect(sol.ties).toContain(h.hold);
      expect(holdValue(analyse(h.dealt), h.hold, pt.pays)).toBeCloseTo(sol.bestValue, 9);
    }
  });

  it('simulated RTP matches every table (4 SE), payouts stay under the max', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
