// Fairness audit: can any way of playing Socks beat the RTP?
//
// A round draws tokens uniformly from the pile (rng.int(pile.length) in the
// UI). While the table has room every draw is free and runs by itself; when
// it is full the round pauses and the only choice is draw or cash out. The
// pair and slot counts are fixed at the bet (disabled while live). Surviving
// a risky draw multiplies the cash-out by 1 / (1 − q), so the claim "cash out
// whenever the next draw looks bad" fails exactly when, at every live state,
// averaging the post-draw value over every token in the pile returns the
// cash-out now. That is checked below by enumerating every pile index through
// the real draw(), at states reached by random rounds (early, mid, near the
// last tokens and next to the max-win cap).
//
// Strategies, per eval config, following Game.tsx's flow (free draws run by
// themselves, the cap auto-cashes before a draw that would pass MAX_WIN):
//   (a) the tester's: draw while the next draw is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end (or the cap);
//   (d) late rider: cash out at a full table unless at most two untouched
//       pairs are left (take only the late, "nearly done" risks);
//   (e) high roller: always draw, cash out once the cash-out reaches 20×.
// Every rule is also valued exactly by summing over the (u, t, cash-out)
// states, which is the binding check where a full clear is rare (the extreme
// config's clear is a 1-in-5000 shot capped at 10 000×; its Monte Carlo
// standard error is far above 0.3% at any practical round count).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_WIN, RTP, VOLATILITY, afterSafeDraw, counts, draw, hitsCap, newDeal, risk, type Deal, type Settings } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

interface View {
  u: number;
  t: number;
  left: number;
  q: number;
  cash: number;
}
/** At a full table (q > 0): true = cash out now. */
type Stop = (s: View) => boolean;

const STRATEGIES: Record<string, Stop> = {
  'a tester (draw only if ≥ 80% safe)': (s) => 1 - s.q < 0.8,
  'b take any profit': (s) => s.cash > 1,
  'c play to the end': () => false,
  'd late rider (risk only when u ≤ 2)': (s) => s.u > 2,
  'e high roller (cash at 20×)': (s) => s.cash >= 20,
};

/** One round as Game.tsx plays it; returns the settled multiplier. */
function playRound({ pairs, slots }: Settings, stop: Stop, rng: Rng): number {
  let deal = newDeal(pairs, slots);
  let cash = RTP;
  while (deal.pile.length > 0) {
    const q = risk(deal);
    if (q > 0) {
      if (hitsCap(cash, q)) return cash; // Max win reached
      const { u, t, left } = counts(deal);
      if (stop({ u, t, left, q, cash })) return cash; // Cash out
    }
    const res = draw(deal, rng.int(deal.pile.length));
    if (res.kind === 'bust') return 0;
    deal = res.deal;
    cash = afterSafeDraw(cash, q);
  }
  return cash; // every token drawn
}

/** Exact value of a stopping rule from (u untouched, t on the table) with the given cash-out. */
function exactValue({ pairs, slots }: Settings, stop: Stop): number {
  const memo = new Map<string, number>();
  const go = (u: number, t: number, cash: number): number => {
    const left = 2 * u + t;
    if (left === 0) return cash;
    const key = `${u}/${t}/${cash.toPrecision(15)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v: number;
    if (t === slots && u > 0) {
      const q = (2 * u) / left;
      if (hitsCap(cash, q) || stop({ u, t, left, q, cash })) v = cash;
      else v = (t / left) * go(u, t - 1, cash / (1 - q)); // a bust pays 0
    } else {
      v = (t > 0 ? (t / left) * go(u, t - 1, cash) : 0) + (u > 0 ? ((2 * u) / left) * go(u - 1, t + 1, cash) : 0);
    }
    memo.set(key, v);
    return v;
  };
  return go(pairs, 0, RTP);
}

/** Live states (deal + cash-out) reached by playing random rounds to a random depth. */
function sampleStates(s: Settings, rng: Rng, count: number): { deal: Deal; cash: number }[] {
  const out: { deal: Deal; cash: number }[] = [];
  while (out.length < count) {
    let deal = newDeal(s.pairs, s.slots);
    let cash = RTP;
    const depth = rng.int(2 * s.pairs);
    for (let i = 0; i < depth && deal.pile.length > 0; i++) {
      const q = risk(deal);
      // Walk only surviving draws so deep (high cash-out) states are reached too.
      const safe = deal.pile.map((_, k) => k).filter((k) => draw(deal, k).kind !== 'bust');
      if (q > 0 && hitsCap(cash, q)) break;
      deal = draw(deal, safe[rng.int(safe.length)]).deal;
      cash = afterSafeDraw(cash, q);
    }
    if (deal.pile.length > 0) out.push({ deal, cash });
  }
  return out;
}

describe('Socks fairness', () => {
  it('martingale: averaging over every token in the pile returns the cash-out now', () => {
    const rng = createRng(seededSource(77));
    let states = 0;
    let risky = 0;
    for (const s of [...Object.values(VOLATILITY), { pairs: 12, slots: 2 }, { pairs: 5, slots: 2 }]) {
      for (const { deal, cash } of sampleStates(s, rng, 40)) {
        const q = risk(deal);
        if (q > 0 && hitsCap(cash, q)) continue; // the UI auto-cashes: no draw is offered
        let ev = 0;
        let busts = 0;
        const n = deal.pile.length;
        for (let i = 0; i < n; i++) {
          const res = draw(deal, i);
          if (res.kind === 'bust') busts++;
          else ev += afterSafeDraw(cash, q) / n;
        }
        // The bust count over the pile is exactly the risk the board shows.
        expect(busts / n).toBeCloseTo(q, 12);
        expect(Math.abs(ev - cash)).toBeLessThan(1e-9 * cash);
        // Nothing ever pays above the cap.
        expect(cash).toBeLessThanOrEqual(MAX_WIN + 1e-6);
        states++;
        if (q > 0) risky++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(150);
    expect(risky).toBeGreaterThanOrEqual(30);
  });

  it('every strategy is worth exactly RTP (exact sums over the states)', () => {
    for (const cfg of evalSpec.configs) {
      for (const stop of Object.values(STRATEGIES)) expect(exactValue(cfg.params, stop)).toBeCloseTo(RTP, 10);
    }
  });

  it('every strategy played draw by draw returns RTP within 4 SE', () => {
    const rows: string[] = [];
    let seed = 1;
    for (const cfg of evalSpec.configs) {
      for (const [name, stop] of Object.entries(STRATEGIES)) {
        const rng = createRng(seededSource(5000 + seed++));
        let sum = 0;
        let sum2 = 0;
        let max = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const m = playRound(cfg.params, stop, rng);
          sum += m;
          sum2 += m * m;
          max = Math.max(max, m);
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
        rows.push(
          `${cfg.label.padEnd(30)} ${name.padEnd(38)} rtp ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}% max ${max.toFixed(2)} (exact ${(exactValue(cfg.params, stop) * 100).toFixed(4)}%)`,
        );
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(MAX_WIN + 1e-6);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(`rounds ${ROUNDS}\n${rows.join('\n')}`);
  });
});
