// Fairness audit: can any way of playing Dragon Tiger beat its stated RTP?
//
// Dragon Tiger has no mid-round decision. The whole round is one bet (a
// layout of chips) and one deal; the cards are drawn after the stake is
// taken and every control is disabled until the deal has been shown. So the
// "cash-out value" has only two states: RTP(layout) × stake before the deal
// and the settled multiplier after it. The martingale check is therefore one
// step: E[settle(layout) over the deal] = layoutRtp(layout), exactly, for
// every layout, using the real deal() and settle(). Strategies (a) "act when
// the next step is safe, else cash out" and (b) "cash out at any profit" have
// nothing to act on and collapse to (c) "play the round". What remains for an
// adversary is the choice of layout and of how to stake across rounds; both
// are covered by (d).

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import { BETS, PAIRS, PAIR_TOTAL, SHOE, deal, layoutRtp, settle, winnerOf, type Card, type Layout } from './math';

const key = (c: Card) => (c.rank - 1) + 13 * c.suit;

/** The exact law of (Dragon kind, Tiger kind) induced by the real deal(), from a grid of uniforms that hits every ordered physical pair once. */
const DEAL_LAW: { d: Card; t: Card; w: number }[] = (() => {
  const w = new Map<number, { d: Card; t: Card; w: number }>();
  for (let i = 0; i < SHOE; i++)
    for (let j = 0; j < SHOE - 1; j++) {
      const r = deal((i + 0.5) / SHOE, (j + 0.5) / (SHOE - 1));
      const k = key(r.dragon) * 52 + key(r.tiger);
      const e = w.get(k);
      if (e) e.w++;
      else w.set(k, { d: r.dragon, t: r.tiger, w: 1 });
    }
  return [...w.values()];
})();

function randomLayout(rng: ReturnType<typeof createRng>): Layout {
  const l: Layout = {};
  const n = 1 + rng.int(5);
  for (let k = 0; k < n; k++) {
    const b = BETS[rng.int(BETS.length)];
    l[b.id] = Math.round(((l[b.id] ?? 0) + 0.01 + rng.int(5000) / 100) * 100) / 100;
  }
  return l;
}

/** Mean, standard error. */
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

describe('Dragon Tiger fairness', () => {
  it('the real deal() induces exactly the enumerated card law (8·7 same kind, 8·8 otherwise)', () => {
    expect(DEAL_LAW.length).toBe(52 * 52);
    const byKey = new Map(PAIRS.map((p) => [key(p.d) * 52 + key(p.t), p.w]));
    for (const e of DEAL_LAW) expect(e.w).toBe(byKey.get(key(e.d) * 52 + key(e.t)));
    expect(DEAL_LAW.reduce((a, e) => a + e.w, 0)).toBe(PAIR_TOTAL);
  });

  it('martingale: for 60 random layouts, E[settled multiplier] over the real deal law equals layoutRtp exactly, and never exceeds the best bet', () => {
    const rng = createRng(seededSource(101));
    const bestBet = Math.max(...BETS.map((b) => layoutRtp({ [b.id]: 1 })));
    expect(bestBet).toBeCloseTo(799 / 830, 14);
    expect(bestBet).toBeLessThan(1);
    // The extremes: single bets, the 1-cent chip (a tie refunds half a cent) and the full table.
    const layouts: Layout[] = [
      { dragon: 0.01 },
      { tiger: 0.01, tie: 0.01 },
      Object.fromEntries(BETS.map((b) => [b.id, 0.01])),
      ...BETS.map((b) => ({ [b.id]: 1 })),
    ];
    while (layouts.length < 60) layouts.push(randomLayout(rng));
    for (const l of layouts) {
      let e = 0;
      for (const { d, t, w } of DEAL_LAW) e += w * settle(l, d, t).multiplier;
      e /= PAIR_TOTAL;
      expect(Math.abs(e - layoutRtp(l))).toBeLessThan(1e-12);
      expect(e).toBeLessThanOrEqual(bestBet + 1e-12);
    }
  });

  it('(a), (b) and (c) are one strategy here; every eval config hits its RTP over 200k rounds (4 SE)', () => {
    const rng = createRng(seededSource(202));
    const n = 200_000;
    evalSpec.configs.forEach((c, i) => {
      expect(c.rtp).toBeCloseTo(configRtp(FAMILIES[i].layouts), 14);
      const xs = new Float64Array(n);
      let max = 0;
      for (let k = 0; k < n; k++) {
        xs[k] = evalSpec.playRound(c.params, rng).multiplier;
        max = Math.max(max, xs[k]);
      }
      const s = stats(xs);
      expect(Math.abs(s.mean - c.rtp!)).toBeLessThan(4 * s.se);
      expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
    });
  }, 120_000);

  it('(d) the strongest plays: best bet, hedge both sides, follow or fade the road, and a loss-doubling progression; none beats 799/830', () => {
    const rng = createRng(seededSource(303));
    const n = 200_000;
    const best = 799 / 830;
    const run = (pick: (last: string | null) => Layout) => {
      const xs = new Float64Array(n);
      let last: string | null = null;
      for (let k = 0; k < n; k++) {
        const l = pick(last);
        const { dragon, tiger } = deal(rng.next(), rng.next());
        xs[k] = settle(l, dragon, tiger).multiplier;
        last = winnerOf(dragon, tiger);
      }
      return stats(xs);
    };
    const results = [
      run(() => ({ dragon: 1 })),
      run(() => ({ dragon: 1, tiger: 1 })),
      run((last): Layout => (last === 'tiger' ? { tiger: 1 } : { dragon: 1 })), // follow the streak
      run((last): Layout => (last === 'dragon' ? { tiger: 1 } : { dragon: 1 })), // fade it
    ];
    for (const s of results) expect(Math.abs(s.mean - best)).toBeLessThan(4 * s.se);

    // Loss-doubling on Dragon (capped at 2^10 units): return per unit wagered is still the bet's RTP.
    let stake = 1;
    let wagered = 0;
    let returned = 0;
    let sq = 0;
    for (let k = 0; k < n; k++) {
      const { dragon, tiger } = deal(rng.next(), rng.next());
      const m = settle({ dragon: stake }, dragon, tiger).multiplier;
      wagered += stake;
      returned += stake * m;
      sq += (stake * (m - best)) ** 2;
      stake = m >= 1 || stake >= 1024 ? 1 : stake * 2;
    }
    // Ratio estimator: SE ≈ sqrt(Σ (sᵢ (mᵢ − rtp))²) / Σ sᵢ.
    expect(Math.abs(returned / wagered - best)).toBeLessThan((4 * Math.sqrt(sq)) / wagered);
  }, 120_000);
});
