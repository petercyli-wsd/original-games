import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MAX_WIN,
  PAIRS,
  RTP,
  SLOTS,
  afterSafeDraw,
  counts,
  dealWinChance,
  draw,
  hasTwinOnTable,
  hitsCap,
  maxMultiplier,
  newDeal,
  risk,
  slotsAllowed,
  winChance,
  type Deal,
} from './math';

const rng = createRng(seededSource(23));

/** A random reachable live deal: plays random safe draws from a fresh deal. */
function reachable(pairs: number, slots: number, r: Rng): Deal {
  let d = newDeal(pairs, slots);
  const steps = r.int(2 * pairs);
  for (let s = 0; s < steps && d.pile.length > 0; s++) {
    const safe = d.pile.map((_, i) => i).filter((i) => draw(d, i).kind !== 'bust');
    d = draw(d, safe[r.int(safe.length)]).deal;
  }
  return d;
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

describe('Socks maths', () => {
  it('with one slot every pair must come out back to back: n! 2^n / (2n)!', () => {
    for (let n = 2; n <= 12; n++) {
      const exact = (factorial(n) * 2 ** n) / factorial(2 * n);
      expect(winChance(n, 1) / exact).toBeCloseTo(1, 10);
    }
  });

  it('with at least n slots nothing can bust', () => {
    for (const n of PAIRS) expect(winChance(n, n)).toBeCloseTo(1, 12);
  });

  it('the DP win chance matches a direct shuffle-and-deal simulation', () => {
    for (const [n, k] of [
      [5, 2],
      [7, 4],
      [8, 4],
      [10, 5],
      [12, 6],
    ]) {
      const rounds = 20_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        // Shuffle all 2n tokens (Fisher–Yates), then deal them in order.
        const tokens = Array.from({ length: 2 * n }, (_, i) => i);
        for (let i = tokens.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
        }
        const table = new Set<number>();
        let ok = true;
        for (const tok of tokens) {
          const pair = tok >> 1;
          if (table.has(pair)) table.delete(pair);
          else if (table.size < k) table.add(pair);
          else {
            ok = false;
            break;
          }
        }
        if (ok) wins++;
      }
      const p = winChance(n, k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('the green twins in the pile are exactly the safe draws', () => {
    for (let trial = 0; trial < 400; trial++) {
      const n = PAIRS[rng.int(PAIRS.length)];
      const k = SLOTS.filter((s) => slotsAllowed(n, s))[rng.int(4)] ?? 2;
      const d = reachable(n, k, rng);
      if (d.pile.length === 0) continue;
      const { t, left } = counts(d);
      const full = t === k;
      let busts = 0;
      for (let i = 0; i < d.pile.length; i++) {
        const res = draw(d, i);
        const bust = res.kind === 'bust';
        if (bust) busts++;
        // A token busts exactly when the table is full and it has no twin there (the red tokens).
        expect(bust).toBe(full && !hasTwinOnTable(d, d.pile[i]));
      }
      expect(busts / left).toBeCloseTo(risk(d), 12);
      if (full) expect(1 - risk(d)).toBeCloseTo(t / left, 12);
    }
  });

  it('each draw is a fair bet: E[cash-out after] = cash-out before', () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = PAIRS[rng.int(PAIRS.length)];
      const k = 2 + rng.int(Math.min(5, n - 2));
      const d = reachable(n, k, rng);
      if (d.pile.length === 0) continue;
      const q = risk(d);
      const cash = RTP * (1 + rng.next() * 5);
      let expected = 0;
      for (let i = 0; i < d.pile.length; i++) {
        const res = draw(d, i);
        expected += (res.kind === 'bust' ? 0 : afterSafeDraw(cash, q)) / d.pile.length;
      }
      expect(expected).toBeCloseTo(cash, 9);
    }
  });

  it('the live win chance is a martingale over the uniform next draw', () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = PAIRS[rng.int(PAIRS.length)];
      const k = 2 + rng.int(Math.min(5, n - 2));
      const d = reachable(n, k, rng);
      if (d.pile.length === 0) continue;
      let next = 0;
      for (let i = 0; i < d.pile.length; i++) {
        const res = draw(d, i);
        next += (res.kind === 'bust' ? 0 : dealWinChance(res.deal)) / d.pile.length;
      }
      expect(next).toBeCloseTo(dealWinChance(d), 12);
    }
  });

  it('the max-win cap bounds every payout, and the manifest is honest', () => {
    expect(hitsCap(MAX_WIN * 0.9, 0.5)).toBe(true);
    expect(hitsCap(MAX_WIN * 0.4, 0.5)).toBe(false);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(MAX_WIN);
    for (const n of PAIRS) for (const k of SLOTS) if (slotsAllowed(n, k)) expect(maxMultiplier(n, k)).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
