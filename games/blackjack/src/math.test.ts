import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BASIC_POLICY,
  CAUTIOUS_POLICY,
  INSURANCE_RTP,
  INSURE_POLICY,
  MAX_MULTIPLIER,
  MIMIC_POLICY,
  PAIRS_PAYS,
  PAIRS_RTP,
  P_VALUE,
  RTP,
  TRIPS_ORDER,
  TRIPS_PAYS,
  TRIPS_RTP,
  TRIPS_WAYS,
  act,
  actionValues,
  basicValue,
  begin,
  best,
  bestAction,
  cardOf,
  ctxOf,
  deal,
  dealerBJChance,
  dealerDist,
  dealerPlay,
  evaluatePolicy,
  expectedHandReturn,
  handResult,
  handTotal,
  pairsKind,
  pairsMult,
  playOut,
  playerDone,
  strategyChart,
  tripsKind,
  tripsMult,
  type Card,
  type Ctx,
  type Table,
} from './math';

const rng = createRng(seededSource(11));
const draw = () => cardOf(rng.int(52));
const C = (rank: number, suit = 0): Card => ({ rank, suit });
/** A draw function that deals a fixed sequence. */
const stack = (cards: Card[]) => {
  let i = 0;
  return () => {
    if (i >= cards.length) throw new Error('stack ran out');
    return cards[i++];
  };
};
const within4SE = (mean: number, target: number, sd: number, n: number) => expect(Math.abs(mean - target)).toBeLessThan((4 * sd) / Math.sqrt(n));

describe('Blackjack dealer', () => {
  it('the exact dealer distribution matches a direct simulation for every up card', () => {
    for (let up = 1; up <= 10; up++) {
      const d = dealerDist(up, false);
      expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      const n = 40_000;
      const counts = [0, 0, 0, 0, 0, 0];
      for (let r = 0; r < n; r++) {
        const cards = [C(up === 10 ? 13 : up), draw()];
        while (handTotal(cards).total < 17) cards.push(draw());
        const t = handTotal(cards).total;
        counts[t > 21 ? 5 : t - 17]++;
      }
      for (let i = 0; i < 6; i++) within4SE(counts[i] / n, d[i], Math.sqrt(d[i] * (1 - d[i])) + 1e-3, n);
    }
  });

  it('stands on soft 17 and hits soft 16', () => {
    const t: Table = { dealer: [C(1), C(6)], hands: [{ cards: [C(10), C(9)], doubled: false, split: false, done: true }], active: 1 };
    expect(dealerPlay(t, stack([])).dealer).toHaveLength(2);
    const t2 = { ...t, dealer: [C(1), C(5)] };
    expect(dealerPlay(t2, stack([C(10), C(3)])).dealer.length).toBeGreaterThan(2);
  });

  it('a peeked dealer never holds blackjack, and the blackjack chance is exact', () => {
    expect(dealerBJChance(1)).toBeCloseTo(4 / 13, 15);
    expect(dealerBJChance(10)).toBeCloseTo(1 / 13, 15);
    // Peeked distribution = unpeeked minus the blackjack mass at 21, renormalised.
    for (const up of [1, 10]) {
      const raw = dealerDist(up, false);
      const peeked = dealerDist(up, true);
      const pBJ = dealerBJChance(up);
      expect(peeked[4] * (1 - pBJ) + pBJ).toBeCloseTo(raw[4], 12);
      expect(peeked[5] * (1 - pBJ)).toBeCloseTo(raw[5], 12);
    }
  });
});

describe('Blackjack exact RTP', () => {
  it('basic strategy RTP from the policy recursion equals the max-over-actions DP, deal by deal', () => {
    // Independent path: for each deal take the best of the exact action values.
    let net = 0;
    for (let up = 1; up <= 10; up++) {
      const pBJ = dealerBJChance(up);
      for (let c1 = 1; c1 <= 10; c1++)
        for (let c2 = 1; c2 <= 10; c2++) {
          const p = P_VALUE[up] * P_VALUE[c1] * P_VALUE[c2];
          const hard = c1 + c2;
          const ace = c1 === 1 || c2 === 1;
          const total = best(hard, ace);
          if (total === 21) {
            net += p * (1 - pBJ) * 1.5;
            continue;
          }
          const ctx: Ctx = { up, hard, ace, total, soft: total !== hard, n: 2, pair: c1 === c2 ? c1 : null, canDouble: true, canSplit: c1 === c2, split: false };
          const v = actionValues(ctx);
          const bestEv = Math.max(v.stand, v.hit, v.double ?? -Infinity, v.split ?? -Infinity);
          net += p * (-pBJ + (1 - pBJ) * bestEv);
        }
    }
    expect(1 + net).toBeCloseTo(RTP, 12);
    expect(manifest.rtp).toBe(RTP);
    // The quoted figure, to the digits in the math.ts header.
    expect(RTP).toBeCloseTo(0.9942961, 7);
    expect(basicValue().rtpPerWagered).toBeCloseTo(0.9949386, 7);
  });

  it('a simulated basic-strategy player matches the exact RTP and stake per round', () => {
    const n = 300_000;
    let sum = 0;
    let sumSq = 0;
    let wag = 0;
    for (let r = 0; r < n; r++) {
      const o = playOut(BASIC_POLICY, { pairs: 0, trips: 0 }, draw);
      const m = 1 + o.returned - o.wagered;
      sum += m;
      sumSq += m * m;
      wag += o.wagered;
    }
    const sd = Math.sqrt(sumSq / n - (sum / n) ** 2);
    within4SE(sum / n, RTP, sd, n);
    within4SE(wag / n, basicValue().wagered, 1, n);
  });

  it('every sampled strategy is priced exactly (simulation within 4 SE)', () => {
    for (const policy of [INSURE_POLICY, MIMIC_POLICY, CAUTIOUS_POLICY]) {
      const exact = evaluatePolicy(policy).rtp;
      const n = 80_000;
      let sum = 0;
      let sumSq = 0;
      for (let r = 0; r < n; r++) {
        const o = playOut(policy, { pairs: 0, trips: 0 }, draw);
        const m = 1 + o.returned - o.wagered;
        sum += m;
        sumSq += m * m;
      }
      within4SE(sum / n, exact, Math.sqrt(sumSq / n - (sum / n) ** 2), n);
      // Basic strategy is optimal: nothing beats it.
      expect(exact).toBeLessThan(RTP);
    }
  });

  it('insurance costs exactly 1/13 of its stake', () => {
    expect(INSURANCE_RTP).toBeCloseTo(3 * (4 / 13), 15);
    const diff = (RTP - evaluatePolicy(INSURE_POLICY).rtp) / ((1 / 13) * 0.5);
    expect(diff).toBeCloseTo(1 / 13, 12);
  });
});

describe('Blackjack side bets', () => {
  it('Pairs: enumeration over 52² gives 51/52 and the paytable rises with rarity', () => {
    let ret = 0;
    const ways = { perfect: 0, coloured: 0, mixed: 0 };
    for (let a = 0; a < 52; a++)
      for (let b = 0; b < 52; b++) {
        ret += pairsMult(cardOf(a), cardOf(b));
        const k = pairsKind(cardOf(a), cardOf(b));
        if (k) ways[k]++;
      }
    expect(ret / 52 ** 2).toBeCloseTo(PAIRS_RTP, 15);
    expect(ways).toEqual({ perfect: 52, coloured: 52, mixed: 104 });
    expect(PAIRS_PAYS.perfect).toBeGreaterThan(PAIRS_PAYS.coloured);
    expect(PAIRS_PAYS.coloured).toBeGreaterThan(PAIRS_PAYS.mixed);
  });

  it('21+3: enumeration over 52³ gives the stated counts and RTP, rarer hands pay more', () => {
    const ways: Record<string, number> = {};
    let ret = 0;
    for (let a = 0; a < 52; a++)
      for (let b = 0; b < 52; b++)
        for (let c = 0; c < 52; c++) {
          const k = tripsKind(cardOf(a), cardOf(b), cardOf(c));
          ret += tripsMult(cardOf(a), cardOf(b), cardOf(c));
          if (k) ways[k] = (ways[k] ?? 0) + 1;
        }
    expect(ways).toEqual(TRIPS_WAYS);
    expect(ret / 52 ** 3).toBeCloseTo(TRIPS_RTP, 15);
    for (let i = 1; i < TRIPS_ORDER.length; i++) {
      expect(TRIPS_WAYS[TRIPS_ORDER[i]]).toBeGreaterThan(TRIPS_WAYS[TRIPS_ORDER[i - 1]]);
      expect(TRIPS_PAYS[TRIPS_ORDER[i]]).toBeLessThan(TRIPS_PAYS[TRIPS_ORDER[i - 1]]);
    }
    expect(tripsKind(C(12), C(13), C(1))).toBe('straight-flush');
    expect(tripsKind(C(13, 0), C(1, 1), C(2, 2))).toBeNull();
  });
});

describe('Blackjack rules engine', () => {
  it('split aces get one card each and an ace-ten after a split pays 1:1', () => {
    // p1, up, p2, hole, then the split draws.
    let t = deal(stack([C(1), C(9), C(1, 1), C(7)]));
    t = begin(t, stack([]));
    t = act(t, 'split', stack([C(13), C(5)]));
    expect(playerDone(t)).toBe(true);
    expect(t.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    t = dealerPlay(t, stack([C(2)]));
    expect(handResult(t.hands[0], t.dealer)).toEqual({ result: 'win', mult: 2 });
  });

  it('no resplit, 21 stands by itself and doubling takes exactly one card', () => {
    let t = begin(deal(stack([C(8), C(6), C(8, 2), C(10)])), stack([]));
    t = act(t, 'split', stack([C(8, 3)]));
    expect(ctxOf(t)!.canSplit).toBe(false);
    t = act(t, 'double', stack([C(3), C(8)]));
    // Hand 1 doubled (8,8,3); hand 2 got its second card (8,8).
    expect(t.hands[0]).toMatchObject({ doubled: true, done: true });
    expect(t.hands[1].cards).toHaveLength(2);
    t = act(t, 'hit', stack([C(5)]));
    expect(handTotal(t.hands[1].cards).total).toBe(21);
    expect(playerDone(t)).toBe(true);
  });

  it('every simulated round ends with all hands finished and one settlement', () => {
    for (let r = 0; r < 20_000; r++) {
      const o = playOut(BASIC_POLICY, { pairs: 1, trips: 1 }, draw);
      expect(o.table.hands.every((h) => h.done || o.table.hands.length === 1)).toBe(true);
      expect(o.returned).toBeGreaterThanOrEqual(0);
      expect(o.returned).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('the max payout is honest and reachable: split, double both, win both, perfect pair + suited trips', () => {
    // Hand 1: split card, then its double; hand 2 gets its card when hand 1 is done.
    const cards = [C(8), C(8), C(8), C(10, 1), C(3), C(10), C(3, 1), C(10, 2)];
    const o = playOut({ name: 'max', play: (c) => (c.canSplit ? 'split' : 'double'), insure: () => false }, { pairs: 1, trips: 1 }, stack(cards));
    expect(o.returned).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBe(135);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });
});

describe('Blackjack strategy and fair value', () => {
  it('the chart has the textbook S17 / double-after-split entries', () => {
    const { hard, soft, pairs } = strategyChart();
    const row = (rows: { label: string; cells: string[] }[], label: string) => rows.find((r) => r.label === label)!.cells;
    // Columns: 2..10, A.
    expect(row(hard, '16')).toEqual(['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H']);
    expect(row(hard, '12')).toEqual(['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H']);
    expect(row(hard, '11').slice(0, 9).every((c) => c === 'D')).toBe(true);
    expect(row(soft, 'A,7')).toEqual(['S', 'Ds', 'Ds', 'Ds', 'Ds', 'S', 'S', 'H', 'H', 'H']);
    expect(row(pairs, 'A,A').every((c) => c === 'P')).toBe(true);
    expect(row(pairs, '8,8').every((c) => c === 'P')).toBe(true);
    expect(row(pairs, '10,10').every((c) => c === 'S')).toBe(true);
    expect(row(pairs, '9,9')).toEqual(['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S']);
  });

  it('the leave-mid-hand value is a martingale under hit/stand play', () => {
    for (let trial = 0; trial < 300; trial++) {
      let t = deal(draw);
      if (handTotal(t.dealer.slice(0, 2)).total === 21 || handTotal(t.hands[0].cards).total === 21) continue;
      t = begin(t, draw);
      if (playerDone(t)) continue;
      const before = expectedHandReturn(t, true);
      const ctx = ctxOf(t)!;
      const v = actionValues(ctx);
      if (v.hit > v.stand) {
        // Average the value after every possible hit card.
        let after = 0;
        for (let i = 0; i < 52; i++) {
          const next = act(t, 'hit', stack([cardOf(i)]));
          after += expectedHandReturn(next, true) / 52;
        }
        expect(after).toBeCloseTo(before, 10);
      } else {
        expect(expectedHandReturn(act(t, 'stand', stack([])), true)).toBeCloseTo(before, 12);
      }
    }
  });

  it('the hint is the best action', () => {
    const ctx: Ctx = { up: 6, hard: 11, ace: false, total: 11, soft: false, n: 2, pair: null, canDouble: true, canSplit: false, split: false };
    expect(bestAction(ctx)).toBe('double');
    expect(bestAction({ ...ctx, canDouble: false })).toBe('hit');
  });
});

describe('Blackjack eval', () => {
  it('simulated RTP matches every config target, and payouts stay under the max', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[reports.length - 1].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
