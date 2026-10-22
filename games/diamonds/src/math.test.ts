import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COLOURS,
  GEMS,
  HANDS,
  HAND_COUNTS,
  HAND_PATTERN,
  MAX_MULTIPLIER,
  OUTCOMES,
  PAYTABLE_CENTS,
  RISKS,
  RTP,
  centsTotal,
  classify,
  handChance,
  payout,
  playRound,
  rtpOf,
  type Hand,
} from './math';

/** Every one of the 7^5 colour sequences, classified. */
function enumerate(): Record<Hand, number> {
  const out = Object.fromEntries(HANDS.map((h) => [h, 0])) as Record<Hand, number>;
  const gems = new Array<number>(GEMS).fill(0);
  for (let n = 0; n < OUTCOMES; n++) {
    let x = n;
    for (let i = 0; i < GEMS; i++) {
      gems[i] = x % COLOURS;
      x = Math.floor(x / COLOURS);
    }
    out[classify(gems).hand]++;
  }
  return out;
}

describe('Diamonds maths', () => {
  it('the closed-form hand counts match a full enumeration of 7^5 rows', () => {
    const counts = enumerate();
    expect(counts).toEqual(HAND_COUNTS);
    expect(HANDS.reduce((s, h) => s + HAND_COUNTS[h], 0)).toBe(OUTCOMES);
  });

  it('every risk table returns exactly 98% (integer identity)', () => {
    for (const risk of RISKS) {
      expect(centsTotal(risk)).toBe(98 * OUTCOMES);
      expect(rtpOf(risk)).toBeCloseTo(RTP, 14);
    }
    expect(manifest.rtp).toBe(RTP);
    // The familiar 50× table, for reference: 16,520 / 16,807.
    const familiar = [0, 10, 200, 300, 400, 500, 5000];
    expect(HANDS.reduce((s, h, i) => s + HAND_COUNTS[h] * familiar[i], 0)).toBe(1_652_000);
  });

  it('hand frequencies of the raw draw match the exact odds (4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    const seen = Object.fromEntries(HANDS.map((h) => [h, 0])) as Record<Hand, number>;
    for (let i = 0; i < n; i++) seen[playRound(rng.next, 'classic').hand]++;
    for (const h of HANDS) {
      const p = handChance(h);
      expect(Math.abs(seen[h] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
    }
  });

  it('paytables are monotone in hand strength and the pattern icons match the hands', () => {
    for (const risk of RISKS) {
      const t = PAYTABLE_CENTS[risk];
      expect(t).toHaveLength(HANDS.length);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
      expect(t[0]).toBe(0);
    }
    for (const h of HANDS) {
      const gems = HAND_PATTERN[h].flatMap((size, colour) => new Array(size).fill(colour));
      expect(gems).toHaveLength(GEMS);
      expect(classify(gems).hand).toBe(h);
    }
    // Classic keeps the familiar tiers.
    expect(PAYTABLE_CENTS.classic.slice(0, 6)).toEqual([0, 10, 200, 300, 400, 500]);
  });

  it('risk spreads results: High std-dev is at least 5x Low', () => {
    const sd = (risk: (typeof RISKS)[number]) => {
      const m2 = HANDS.reduce((s, h) => s + handChance(h) * payout(risk, h) ** 2, 0);
      return Math.sqrt(m2 - RTP ** 2);
    };
    expect(sd('high') / sd('low')).toBeGreaterThan(5);
  });

  it('a round draws exactly five gems and resolves once', () => {
    let calls = 0;
    const src = seededSource(5);
    const r = playRound(() => (calls++, src()), 'high');
    expect(calls).toBe(GEMS);
    expect(r.gems).toHaveLength(GEMS);
    expect(r.multiplier).toBe(payout('high', r.hand));
    // Group sizes are consistent with the hand.
    expect(classify([3, 3, 3, 3, 3]).groupSize).toEqual([5, 5, 5, 5, 5]);
    expect(classify([0, 1, 0, 2, 1])).toEqual({ hand: 'twoPair', groupSize: [2, 2, 2, 1, 2] });
    // The edge of the unit interval still maps to a valid colour.
    expect(playRound(() => 0.9999999999, 'low').hand).toBe('five');
  });

  it('the max multiplier is honest and reachable', () => {
    expect(MAX_MULTIPLIER).toBe(Math.max(...RISKS.map((r) => payout(r, 'five'))));
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(playRound(() => 0.5, 'high').multiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 100_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
