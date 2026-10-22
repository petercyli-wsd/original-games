import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import {
  BET_IDS,
  MAX_MULTIPLIER,
  PAYS,
  RTP,
  SHOE,
  VALUE_COUNT,
  bankerDraws,
  betRtp,
  betWinChance,
  deal,
  joint,
  layoutRtp,
  layoutStats,
  pairBothClosed,
  pairClosed,
  perfectBothClosed,
  probOf,
  resultOf,
  returnOf,
  scaleLayout,
  settle,
  stakeOf,
  suitedClosed,
  totalOf,
  volatilityOf,
  type BetId,
  type Card,
  type Layout,
  type Variant,
} from './math';

const VARIANTS: Variant[] = ['classic', 'nocomm'];

/**
 * An independent brute force over card values: always draw six ordered cards
 * (P, B, P, B, fifth, sixth) and let the tableau decide which are used, so
 * unused cards are summed out. 10⁶ sequences, exact falling-count weights.
 */
function bruteForce() {
  const c = VALUE_COUNT.slice();
  const out = { P: 0, B: 0, B6: 0, T: 0 };
  const seq: number[] = [];
  const rec = (depth: number, w: number, left: number) => {
    if (depth === 6) {
      const [p1, b1, p2, b2, x5, x6] = seq;
      let pt = (p1 + p2) % 10;
      let bt = (b1 + b2) % 10;
      if (pt < 8 && bt < 8) {
        let next = x5;
        let p3: number | null = null;
        if (pt <= 5) {
          p3 = x5;
          pt = (pt + x5) % 10;
          next = x6;
        }
        if (bankerDraws(bt, p3)) bt = (bt + next) % 10;
      }
      if (pt > bt) out.P += w;
      else if (bt > pt) out[bt === 6 ? 'B6' : 'B'] += w;
      else out.T += w;
      return;
    }
    for (let v = 0; v < 10; v++) {
      if (!c[v]) continue;
      const wv = (w * c[v]) / left;
      c[v]--;
      seq.push(v);
      rec(depth + 1, wv, left - 1);
      seq.pop();
      c[v]++;
    }
  };
  rec(0, 1, SHOE);
  return out;
}

const card = (rank: number, suit = 0): Card => ({ rank, suit });

/** Replays a fixed sequence of cards through `deal` by mapping each card to its uniform in a fresh-ish shoe. */
function dealCards(cards: Card[]) {
  // Draw by kind index: build uniforms that hit the wanted kind given the shoe state.
  const shoe = Array.from({ length: 52 }, () => 8);
  let i = 0;
  return deal(() => {
    const c = cards[i++];
    const k = (c.rank - 1) * 4 + c.suit;
    const left = shoe.reduce((a, b) => a + b, 0);
    let before = 0;
    for (let j = 0; j < k; j++) before += shoe[j];
    shoe[k]--;
    return (before + 0.5) / left;
  });
}

describe('Baccarat maths', () => {
  it('the joint table sums to 1 and gives the known 8-deck odds', () => {
    const j = joint();
    expect(j.reduce((a, c) => a + c.p, 0)).toBeCloseTo(1, 12);
    expect(probOf((c) => c.win === 'B')).toBeCloseTo(0.458597423, 9);
    expect(probOf((c) => c.win === 'P')).toBeCloseTo(0.446246609, 9);
    expect(probOf((c) => c.win === 'T')).toBeCloseTo(0.095155968, 9);
  });

  it('matches an independent brute force over all six-card value sequences', () => {
    const b = bruteForce();
    expect(probOf((c) => c.win === 'P')).toBeCloseTo(b.P, 10);
    expect(probOf((c) => c.win === 'B' && !c.b6)).toBeCloseTo(b.B, 10);
    expect(probOf((c) => c.b6)).toBeCloseTo(b.B6, 10);
    expect(probOf((c) => c.win === 'T')).toBeCloseTo(b.T, 10);
  });

  it('every bet returns its exact RTP (main bets to 8 places, side bets in closed form)', () => {
    expect(betRtp('banker', 'classic')).toBeCloseTo(0.98942094, 8);
    expect(betRtp('player', 'classic')).toBeCloseTo(0.98764919, 8);
    expect(betRtp('tie', 'classic')).toBeCloseTo(0.85640371, 8);
    expect(betRtp('banker', 'nocomm')).toBeCloseTo(0.98541896, 8);
    // Closed forms.
    const pBoth = pairBothClosed();
    const sBoth = perfectBothClosed();
    expect(probOf((c) => c.pp)).toBeCloseTo(pairClosed, 13);
    expect(probOf((c) => c.bp)).toBeCloseTo(pairClosed, 13);
    expect(probOf((c) => c.pp && c.bp)).toBeCloseTo(pBoth, 13);
    expect(probOf((c) => c.sp === 2)).toBeCloseTo(sBoth, 13);
    expect(probOf((c) => c.sp >= 1)).toBeCloseTo(2 * suitedClosed - sBoth, 13);
    for (const v of VARIANTS) {
      expect(betRtp('playerPair', v)).toBeCloseTo((12 * 31) / 415, 13);
      expect(betRtp('bankerPair', v)).toBeCloseTo((12 * 31) / 415, 13);
      expect(betRtp('eitherPair', v)).toBeCloseTo(6 * (2 * pairClosed - pBoth), 13);
      expect(betRtp('perfectPair', v)).toBeCloseTo(26 * (2 * suitedClosed - 2 * sBoth) + 201 * sBoth, 13);
      expect(betRtp('player', v)).toBeCloseTo(betRtp('player', 'classic'), 14);
      expect(betRtp('tie', v)).toBeCloseTo(9 * probOf((c) => c.win === 'T'), 13);
    }
    // No commission: Banker pays even money except a winning 6 at half.
    const pB6 = probOf((c) => c.b6);
    const pB = probOf((c) => c.win === 'B');
    const pT = probOf((c) => c.win === 'T');
    expect(betRtp('banker', 'nocomm')).toBeCloseTo(2 * (pB - pB6) + 1.5 * pB6 + pT, 13);
    expect(manifest.rtp).toBe(RTP);
    expect(RTP).toBeCloseTo(1.95 * pB + pT, 13);
  });

  it('applies the third-card tableau', () => {
    // Natural: nobody draws.
    let d = dealCards([card(9), card(3), card(13), card(2)]);
    expect(d.natural).toBe(true);
    expect(d.player.length + d.banker.length).toBe(4);
    expect(d.winner).toBe('player');
    // Player 6 stands, Banker 5 draws.
    d = dealCards([card(4), card(2), card(2), card(3), card(1)]);
    expect([d.player.length, d.banker.length]).toEqual([2, 3]);
    expect(d.bTotal).toBe(6);
    expect(d.winner).toBe('tie');
    // Player 6 stands, Banker 6 stands.
    d = dealCards([card(4), card(3), card(2), card(3)]);
    expect([d.player.length, d.banker.length]).toEqual([2, 2]);
    // Player draws an 8; Banker on 3 stands.
    d = dealCards([card(2), card(1), card(3), card(2), card(8)]);
    expect([d.player.length, d.banker.length]).toEqual([3, 2]);
    // Player draws a 7; Banker on 6 draws.
    d = dealCards([card(1), card(3), card(13), card(3), card(7), card(5)]);
    expect([d.player.length, d.banker.length]).toEqual([3, 3]);
    expect(d.order).toEqual(['P', 'B', 'P', 'B', 'P', 'B']);
    // Player draws a 1; Banker on 4 stands.
    d = dealCards([card(1), card(2), card(1), card(2), card(1)]);
    expect([d.player.length, d.banker.length]).toEqual([3, 2]);
    // The full rule table against the written tableau.
    const draws = (bt: number, x: number) =>
      bt <= 2 || (bt === 3 && x !== 8) || (bt === 4 && x >= 2 && x <= 7) || (bt === 5 && x >= 4 && x <= 7) || (bt === 6 && x >= 6 && x <= 7);
    for (let bt = 0; bt <= 7; bt++) {
      expect(bankerDraws(bt, null)).toBe(bt <= 5);
      for (let x = 0; x <= 9; x++) expect(bankerDraws(bt, x)).toBe(draws(bt, x));
    }
    expect(totalOf([card(13), card(12), card(9)])).toBe(9);
    expect(totalOf([card(7), card(8)])).toBe(5);
  });

  it('simulated deals match the exact table (winner, pairs, suited pairs; 4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    const counts = { P: 0, B: 0, T: 0, B6: 0, pp: 0, bp: 0, s1: 0, any: 0 };
    for (let i = 0; i < n; i++) {
      const r = resultOf(deal(() => rng.next()));
      counts[r.win]++;
      if (r.b6) counts.B6++;
      if (r.pp) counts.pp++;
      if (r.bp) counts.bp++;
      if (r.sp >= 1) counts.s1++;
      if (r.pp || r.bp) counts.any++;
    }
    const check = (hits: number, p: number) => expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    check(counts.P, probOf((c) => c.win === 'P'));
    check(counts.B, probOf((c) => c.win === 'B'));
    check(counts.T, probOf((c) => c.win === 'T'));
    check(counts.B6, probOf((c) => c.b6));
    check(counts.pp, pairClosed);
    check(counts.bp, pairClosed);
    check(counts.s1, probOf((c) => c.sp >= 1));
    check(counts.any, betWinChance('eitherPair', 'classic'));
  });

  it('simulated return of every bet matches its exact RTP (4 SE)', () => {
    const rng = createRng(seededSource(5));
    const n = 120_000;
    const results = Array.from({ length: n }, () => resultOf(deal(() => rng.next())));
    for (const v of VARIANTS) {
      for (const id of BET_IDS) {
        let s = 0;
        let s2 = 0;
        for (const r of results) {
          const m = returnOf(id, r, v);
          s += m;
          s2 += m * m;
        }
        const mean = s / n;
        const se = Math.sqrt((s2 / n - mean * mean) / n);
        expect(Math.abs(mean - betRtp(id, v))).toBeLessThan(4 * se + 1e-12);
      }
    }
  });

  it('a layout returns the stake-weighted average RTP, exactly', () => {
    const rng = createRng(seededSource(9));
    for (let t = 0; t < 60; t++) {
      const l: Layout = {};
      for (const id of BET_IDS) if (rng.next() < 0.45) l[id] = 0.01 * (1 + rng.int(500));
      if (!stakeOf(l)) continue;
      const v = VARIANTS[t % 2];
      expect(layoutStats(l, v).rtp).toBeCloseTo(layoutRtp(l, v), 12);
    }
  });

  it('paytable sanity: rarer bets pay more; pushes return the stake', () => {
    const order: BetId[] = ['banker', 'player', 'eitherPair', 'tie', 'playerPair', 'perfectPair'];
    for (let i = 1; i < order.length; i++) {
      expect(betWinChance(order[i], 'classic')).toBeLessThan(betWinChance(order[i - 1], 'classic'));
    }
    const pays = [PAYS.banker, PAYS.player, PAYS.eitherPair, PAYS.tie, PAYS.pair, PAYS.perfectOne];
    for (let i = 1; i < pays.length; i++) expect(pays[i]).toBeGreaterThanOrEqual(pays[i - 1]);
    const tie = { win: 'T', b6: false, pp: false, bp: false, sp: 0 } as const;
    for (const v of VARIANTS) {
      expect(returnOf('player', tie, v)).toBe(1);
      expect(returnOf('banker', tie, v)).toBe(1);
      expect(settle({ player: 2, banker: 3 }, tie, v).multiplier).toBe(1);
    }
  });

  it('the max multiplier is honest: 201 on a lone Perfect Pair, never exceeded by any layout', () => {
    expect(MAX_MULTIPLIER).toBe(201);
    expect(manifest.maxMultiplier).toBe(201);
    expect(layoutStats({ perfectPair: 1 }, 'classic').maxMult).toBe(201);
    const rng = createRng(seededSource(21));
    for (let t = 0; t < 200; t++) {
      const l: Layout = {};
      for (const id of BET_IDS) if (rng.next() < 0.5) l[id] = 0.01 * (1 + rng.int(800));
      if (!stakeOf(l)) continue;
      for (const v of VARIANTS) expect(layoutStats(l, v).maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
  });

  it('one deal uses 4 to 6 uniforms, one per card, and resolves once (the auto-bet play path)', () => {
    const rng = createRng(seededSource(3));
    for (let t = 0; t < 2000; t++) {
      let calls = 0;
      const d = deal(() => (calls++, rng.next()));
      expect(calls).toBe(d.player.length + d.banker.length);
      expect(d.order.length).toBe(calls);
      expect(calls).toBeGreaterThanOrEqual(4);
      expect(calls).toBeLessThanOrEqual(6);
      expect(d.pTotal).toBe(totalOf(d.player));
      expect(d.bTotal).toBe(totalOf(d.banker));
    }
  });

  it('auto-bet scaling keeps the proportions and hits the target total to the cent', () => {
    const base: Layout = { banker: 3, tie: 0.5, perfectPair: 0.25 };
    for (const target of [0.37, 1, 4.5, 18, 123.45]) {
      const s = scaleLayout(base, target);
      expect(Math.round(stakeOf(s) * 100)).toBe(Math.round(target * 100));
      expect(Object.keys(s).sort()).toEqual(Object.keys(base).sort());
    }
  });

  it('volatility spans low to extreme', () => {
    expect(volatilityOf(layoutStats({ banker: 1 }, 'classic').sd)).toBe('low');
    expect(volatilityOf(layoutStats({ eitherPair: 1 }, 'classic').sd)).toBe('medium');
    expect(volatilityOf(layoutStats({ tie: 1 }, 'classic').sd)).toBe('high');
    expect(volatilityOf(layoutStats({ perfectPair: 1 }, 'classic').sd)).toBe('extreme');
  });

  it('eval configs declare their exact RTP; runEval is within 4 SE and the max is honest', () => {
    const reports = runEval(evalSpec, { rounds: 50_000 });
    reports.forEach((r, i) => {
      const target = configRtp(FAMILIES[i].spots);
      expect(r.targetRtp).toBeCloseTo(target, 14);
      expect(Math.abs(r.rtp - target)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    });
  });
});
