// Fairness audit: can any way of playing Baccarat beat its stated RTP?
//
// Baccarat has no mid-round decision: the player builds a layout, presses
// Bet, and the stake is taken before deal() draws a single card. Felt, chips,
// table rules and hotkeys are all disabled while the cards are shown, and the
// stake that settles is the layout captured at bet time. So the cash-out
// value has two states, RTP(layout, rules) × stake before the deal and the
// settled multiplier after it, and the martingale check is one exact step:
// E[settle] over the deal = layoutRtp. Strategies (a) "act when the next step
// is safe, else cash out" and (b) "cash out at any profit" have nothing to
// act on and collapse to (c) "play the round". What is left to an adversary
// is the choice of layout and table rules, reading the bead road, and how to
// stake across rounds; (d) covers each.
//
// The exhaustive check that deal() itself produces the joint table (every
// ordered deal pushed through the real deal()) takes ~1.5M deals and lives
// in the audit's scratch script; here we check drawCard() is exactly uniform
// and the simulated deals agree statistically (math.test.ts does too).

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import { BET_IDS, betRtp, deal, drawCard, freshShoe, joint, layoutRtp, resultOf, settle, type Layout, type Result, type Variant } from './math';

const VARIANTS: Variant[] = ['classic', 'nocomm'];

function stats(xs: Float64Array) {
  let s = 0;
  let s2 = 0;
  for (const x of xs) {
    s += x;
    s2 += x * x;
  }
  const m = s / xs.length;
  return { mean: m, se: Math.sqrt(Math.max(0, s2 / xs.length - m * m) / xs.length) };
}

/** 200k real deals, shared by the strategy runs (each strategy's rounds are still i.i.d.). */
let dealsCache: Result[] | null = null;
function sharedDeals(): Result[] {
  if (dealsCache) return dealsCache;
  const rng = createRng(seededSource(31));
  const out: Result[] = [];
  for (let k = 0; k < 200_000; k++) out.push(resultOf(deal(() => rng.next())));
  return (dealsCache = out);
}

describe('Baccarat fairness', () => {
  it('drawCard maps the uniform exactly onto the cards left in the shoe (any shoe state)', () => {
    const rng = createRng(seededSource(7));
    for (let trial = 0; trial < 12; trial++) {
      const shoe = freshShoe();
      // Remove 0–5 random cards first, as a deal does.
      for (let k = 0; k < trial % 6; k++) drawCard(shoe, rng.next());
      const left = shoe.reduce((a, b) => a + b, 0);
      const hits = new Array(52).fill(0);
      for (let i = 0; i < left; i++) {
        const s = shoe.slice();
        const c = drawCard(s, (i + 0.5) / left);
        hits[(c.rank - 1) * 4 + c.suit]++;
      }
      expect(hits).toEqual(shoe);
    }
  });

  it('martingale: for 60 random layouts under both rule sets, E[settled multiplier] over the exact deal law equals layoutRtp, never above the best bet', () => {
    const rng = createRng(seededSource(11));
    const cells = joint();
    expect(Math.abs(cells.reduce((a, c) => a + c.p, 0) - 1)).toBeLessThan(1e-12);
    const bestBet = Math.max(...VARIANTS.flatMap((v) => BET_IDS.map((id) => betRtp(id, v))));
    expect(bestBet).toBeCloseTo(betRtp('banker', 'classic'), 14);
    expect(bestBet).toBeLessThan(1);
    const layouts: Layout[] = [
      { banker: 0.01 },
      { player: 0.01, banker: 0.01 },
      Object.fromEntries(BET_IDS.map((id) => [id, 0.01])),
      ...BET_IDS.map((id) => ({ [id]: 1 })),
    ];
    while (layouts.length < 60) {
      const l: Layout = {};
      for (let k = 1 + rng.int(4); k > 0; k--) {
        const id = BET_IDS[rng.int(BET_IDS.length)];
        l[id] = Math.round(((l[id] ?? 0) + 0.01 + rng.int(5000) / 100) * 100) / 100;
      }
      layouts.push(l);
    }
    for (const l of layouts)
      for (const v of VARIANTS) {
        let e = 0;
        for (const c of cells) e += c.p * settle(l, c, v).multiplier;
        expect(Math.abs(e - layoutRtp(l, v))).toBeLessThan(1e-12);
        expect(e).toBeLessThanOrEqual(bestBet + 1e-12);
      }
  });

  it('(a), (b) and (c) are one strategy here; every eval config hits its RTP over 200k rounds (4 SE)', () => {
    // The same sampling as eval.ts (a spot uniformly from the family, scaled by 1–5 chips), on the shared deals.
    const rng = createRng(seededSource(23));
    const results = sharedDeals();
    const n = results.length;
    evalSpec.configs.forEach((c, i) => {
      expect(c.rtp).toBeCloseTo(configRtp(FAMILIES[i].spots), 14);
      const xs = new Float64Array(n);
      let max = 0;
      for (let k = 0; k < n; k++) {
        const spot = FAMILIES[i].spots[rng.int(FAMILIES[i].spots.length)];
        const f = 1 + rng.int(5);
        const l: Layout = Object.fromEntries(Object.entries(spot.layout).map(([id, v]) => [id, (v ?? 0) * f]));
        xs[k] = settle(l, results[k], spot.variant).multiplier;
        max = Math.max(max, xs[k]);
      }
      const s = stats(xs);
      expect(Math.abs(s.mean - c.rtp!)).toBeLessThan(4 * s.se);
      expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
    });
    // And the eval's own playRound, which deals for itself (fewer rounds: it is the slow path).
    const own = createRng(seededSource(29));
    for (const c of evalSpec.configs) {
      const xs = new Float64Array(20_000);
      for (let k = 0; k < xs.length; k++) xs[k] = evalSpec.playRound(c.params, own).multiplier;
      const s = stats(xs);
      expect(Math.abs(s.mean - c.rtp!)).toBeLessThan(4 * s.se);
    }
  }, 300_000);

  it('(d) best bet under each rule set, hedges, reading the road, and a loss-doubling progression: none beats Banker Classic', () => {
    const results = sharedDeals();
    const n = results.length;
    const run = (pick: (prev: Result | null) => [Layout, Variant]) => {
      const xs = new Float64Array(n);
      let target = 0;
      for (let k = 0; k < n; k++) {
        const [l, v] = pick(k ? results[k - 1] : null);
        xs[k] = settle(l, results[k], v).multiplier;
        target += layoutRtp(l, v);
      }
      return { ...stats(xs), target: target / n };
    };
    const best = betRtp('banker', 'classic');
    const strategies = [
      run(() => [{ banker: 1 }, 'classic']),
      run(() => [{ banker: 1 }, 'nocomm']),
      run(() => [{ player: 1 }, 'classic']),
      run(() => [{ player: 1, banker: 1 }, 'classic']),
      // Follow the road: back whoever won last (Banker after a tie).
      run((prev) => [prev?.win === 'P' ? { player: 1 } : { banker: 1 }, 'classic']),
      // Chase pairs after a pair-less streak (the road can't change the next shoe).
      run((prev) => [prev && !prev.pp && !prev.bp ? { banker: 1, playerPair: 0.1, bankerPair: 0.1 } : { banker: 1 }, 'classic']),
    ];
    for (const s of strategies) {
      expect(Math.abs(s.mean - s.target)).toBeLessThan(4 * s.se);
      expect(s.target).toBeLessThanOrEqual(best + 1e-12);
    }
    // Loss-doubling on Banker (capped at 2^10): return per unit wagered is still the bet's RTP.
    let stake = 1;
    let wagered = 0;
    let returned = 0;
    let sq = 0;
    for (let k = 0; k < n; k++) {
      const m = settle({ banker: stake }, results[k], 'classic').multiplier;
      wagered += stake;
      returned += stake * m;
      sq += (stake * (m - best)) ** 2;
      stake = m > 1 || stake >= 1024 ? 1 : m === 1 ? stake : stake * 2;
    }
    expect(Math.abs(returned / wagered - best)).toBeLessThan((4 * Math.sqrt(sq)) / wagered);
  }, 300_000);
});
