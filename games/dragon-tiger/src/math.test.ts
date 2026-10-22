import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import {
  BETS,
  BET_BY_ID,
  MAX_MULTIPLIER,
  PAIRS,
  PAIR_TOTAL,
  P_SIDE_BET,
  P_SIDE_WIN,
  P_SUITED,
  P_TIE,
  RTP,
  SHOE,
  SIDE_KINDS,
  betStats,
  deal,
  isSuitedTie,
  layoutRtp,
  layoutStats,
  returnOf,
  scaleLayout,
  settle,
  shoeCard,
  sideWins,
  totalOf,
  winnerOf,
  type Card,
  type Layout,
} from './math';

/** Closed-form RTPs from the header, as exact fractions. */
const CLOSED: Record<string, number> = {
  main: 399.5 / 415,
  tie: 279 / 415,
  suited: 357 / 415,
  side: 12 / 13,
};
const closedRtp = (id: string) => {
  const k = BET_BY_ID[id].kind;
  return k === 'main' ? CLOSED.main : k === 'tie' ? CLOSED.tie : k === 'suited' ? CLOSED.suited : CLOSED.side;
};

describe('Dragon Tiger maths', () => {
  it('the table has Dragon, Tiger, Tie, Suited tie and six side bets per side', () => {
    expect(BETS).toHaveLength(16);
    expect(new Set(BETS.map((b) => b.id)).size).toBe(16);
    expect(PAIRS).toHaveLength(52 * 52);
    expect(PAIRS.reduce((a, p) => a + p.w, 0)).toBe(PAIR_TOTAL);
    expect(PAIR_TOTAL).toBe(416 * 415);
  });

  it('enumerated probabilities match the closed forms', () => {
    let tie = 0;
    let suited = 0;
    let dragon = 0;
    for (const { d, t, w } of PAIRS) {
      const win = winnerOf(d, t);
      if (win === 'tie') tie += w;
      if (win === 'dragon') dragon += w;
      if (isSuitedTie(d, t)) suited += w;
    }
    expect(tie / PAIR_TOTAL).toBeCloseTo(P_TIE, 14);
    expect(suited / PAIR_TOTAL).toBeCloseTo(P_SUITED, 14);
    expect(dragon / PAIR_TOTAL).toBeCloseTo(P_SIDE_WIN, 14);
    // Integer form: ties are 31 / 415 of all ordered pairs, suited ties 7 / 415.
    expect(tie * 415).toBe(31 * PAIR_TOTAL);
    expect(suited * 415).toBe(7 * PAIR_TOTAL);
  });

  it('every bet returns exactly its closed-form RTP (enumeration of 52 × 52 kinds)', () => {
    for (const b of BETS) expect(betStats(b.id).rtp, b.id).toBeCloseTo(closedRtp(b.id), 14);
    expect(RTP).toBeCloseTo(799 / 830, 15);
    expect(manifest.rtp).toBeCloseTo(0.96265060241, 10);
    expect(betStats('dragon').chance).toBeCloseTo(192 / 415, 14);
    expect(betStats('dragon').partial).toBeCloseTo(31 / 415, 14);
    expect(betStats('tie').chance).toBeCloseTo(31 / 415, 14);
    expect(betStats('suited').chance).toBeCloseTo(7 / 415, 14);
    for (const k of SIDE_KINDS) {
      expect(betStats(`dragon-${k}`).chance).toBeCloseTo(P_SIDE_BET, 14);
      expect(betStats(`tiger-${k}`).chance).toBeCloseTo(P_SIDE_BET, 14);
    }
  });

  it('side bets: a 7 loses all six; each covers exactly 24 of the 52 kinds', () => {
    for (const k of SIDE_KINDS) {
      let n = 0;
      for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) if (sideWins(k, { rank: r, suit: s })) n++;
      expect(n, k).toBe(24);
      for (let s = 0; s < 4; s++) expect(sideWins(k, { rank: 7, suit: s })).toBe(false);
    }
    // Complementary pairs never both win and together cover everything but the 7s.
    for (const [a, b] of [['big', 'small'], ['odd', 'even'], ['red', 'black']] as const)
      for (let r = 1; r <= 13; r++)
        for (let s = 0; s < 4; s++) {
          const c: Card = { rank: r, suit: s };
          expect(sideWins(a, c) && sideWins(b, c)).toBe(false);
          expect(sideWins(a, c) || sideWins(b, c)).toBe(r !== 7);
        }
  });

  it('paytable sanity: the rarer the event, the bigger the pay; Dragon and Tiger are mirror images', () => {
    expect(BET_BY_ID.suited.pays).toBeGreaterThan(BET_BY_ID.tie.pays);
    expect(BET_BY_ID.tie.pays).toBeGreaterThan(BET_BY_ID.dragon.pays);
    expect(betStats('dragon')).toEqual(betStats('tiger'));
    for (const k of SIDE_KINDS) expect(betStats(`dragon-${k}`)).toEqual(betStats(`tiger-${k}`));
    // Dragon on a tie returns half the chip, Tie pays 9 total, Suited tie 51.
    const d: Card = { rank: 9, suit: 0 };
    expect(returnOf(BET_BY_ID.dragon, d, { rank: 9, suit: 2 })).toBe(0.5);
    expect(returnOf(BET_BY_ID.tie, d, { rank: 9, suit: 2 })).toBe(9);
    expect(returnOf(BET_BY_ID.suited, d, { rank: 9, suit: 2 })).toBe(0);
    expect(returnOf(BET_BY_ID.suited, d, { rank: 9, suit: 0 })).toBe(51);
    expect(returnOf(BET_BY_ID.tiger, d, { rank: 13, suit: 1 })).toBe(2);
    expect(returnOf(BET_BY_ID.dragon, { rank: 1, suit: 0 }, { rank: 2, suit: 0 })).toBe(0); // aces are low
  });

  it('layout RTP is the stake-weighted average, checked by full enumeration', () => {
    const rng = createRng(seededSource(11));
    for (let n = 0; n < 40; n++) {
      const l: Layout = {};
      for (const b of BETS) if (rng.next() < 0.3) l[b.id] = 1 + Math.floor(rng.next() * 20);
      if (!(totalOf(l) > 0)) continue;
      const s = layoutStats(l);
      expect(s.rtp).toBeCloseTo(layoutRtp(l), 12);
      expect(s.maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
    expect(layoutStats({ suited: 1 }).maxMult).toBe(MAX_MULTIPLIER);
    expect(layoutStats({ dragon: 1, tiger: 1 }).rtp).toBeCloseTo(CLOSED.main, 14);
  });

  it('the deal is uniform over ordered pairs of distinct shoe cards', () => {
    // Exhaustive over a grid of uniforms: every (i, j ≠ i) pair is hit exactly once.
    const seen = new Set<number>();
    let bad = 0;
    const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
    for (let i = 0; i < SHOE; i++)
      for (let j = 0; j < SHOE - 1; j++) {
        const jj = j >= i ? j + 1 : j;
        const r = deal((i + 0.5) / SHOE, (j + 0.5) / (SHOE - 1));
        if (!same(r.dragon, shoeCard(i)) || !same(r.tiger, shoeCard(jj))) bad++;
        seen.add(i * SHOE + jj);
      }
    expect(bad).toBe(0);
    expect(seen.size).toBe(SHOE * (SHOE - 1));
    // Each kind appears exactly 8 times in the shoe.
    const counts = new Array(52).fill(0);
    for (let i = 0; i < SHOE; i++) counts[(shoeCard(i).rank - 1) + 13 * shoeCard(i).suit]++;
    expect(counts.every((c) => c === 8)).toBe(true);
  });

  it('simulated deals match the exact tie, suited tie and Dragon chances', () => {
    const rng = createRng(seededSource(5));
    const n = 400_000;
    let tie = 0;
    let suited = 0;
    let dragon = 0;
    for (let k = 0; k < n; k++) {
      const { dragon: d, tiger: t } = deal(rng.next(), rng.next());
      const w = winnerOf(d, t);
      if (w === 'tie') tie++;
      if (w === 'dragon') dragon++;
      if (isSuitedTie(d, t)) suited++;
    }
    for (const [hits, p] of [
      [tie, P_TIE],
      [suited, P_SUITED],
      [dragon, P_SIDE_WIN],
    ] as const)
      expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('settle pays chips correctly and scaleLayout keeps the total exact', () => {
    const l: Layout = { dragon: 10, tie: 2, suited: 1, 'tiger-red': 3 };
    const r = settle(l, { rank: 5, suit: 1 }, { rank: 5, suit: 1 });
    // Dragon half back 5, Tie 18, Suited 51, Tiger red on a red 5: 6.
    expect(r.paid).toBe(5 + 18 + 51 + 6);
    expect(r.multiplier).toBeCloseTo(80 / 16, 12);
    const s = scaleLayout(l, 7.77);
    expect(totalOf(s)).toBe(7.77);
    expect(layoutRtp(s)).toBeCloseTo(layoutRtp(l), 2);
  });

  it('eval configs: declared RTPs are exact, spread volatility, and the simulation agrees', () => {
    expect(configRtp(FAMILIES[0].layouts)).toBeCloseTo(RTP, 14);
    const results = runEval(evalSpec, { rounds: 60_000 });
    for (const r of results) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(betStats('suited').sd / betStats('dragon').sd).toBeGreaterThan(5);
  });

  it('auto-bet play resolves once per round (one deal per bet)', () => {
    const rng = createRng(seededSource(9));
    let rounds = 0;
    for (let k = 0; k < 1000; k++) {
      const res = evalSpec.playRound({ family: k % 4 }, rng);
      expect(res.steps).toBe(1);
      rounds++;
    }
    expect(rounds).toBe(1000);
  });
});
