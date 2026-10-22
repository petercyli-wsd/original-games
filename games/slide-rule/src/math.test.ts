import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIGITS,
  FACTORS,
  LENGTHS,
  MAX_MULTIPLIER,
  RTP,
  VOLATILITY,
  benford,
  blockReason,
  cashOut,
  dialPosition,
  digitCounts,
  digitOdds,
  digitSet,
  hasDigit,
  leadingDigit,
  nextLandings,
  prizeFor,
  sectorStart,
  sequences,
  startChance,
  turnFor,
  winChance,
  winCount,
  type DigitSet,
  type Length,
} from './math';

const rng = createRng(seededSource(11));

/** Every factor sequence of length j, multiplied out (brute force, no tables). */
function allProducts(j: number): number[] {
  let out = [1];
  for (let i = 0; i < j; i++) out = out.flatMap((p) => FACTORS.map((f) => p * f));
  return out;
}

/** A random reachable live state: a product after some factors, and how many are left (≥ 1). */
function randomState(): { c: number; j: number } {
  const k = LENGTHS[rng.int(LENGTHS.length)];
  const done = rng.int(k);
  let c = 1;
  for (let i = 0; i < done; i++) c *= FACTORS[rng.int(8)];
  return { c, j: k - done };
}

const randomDigits = (): DigitSet => {
  let s = 0;
  while (s === 0) for (const d of DIGITS) if (rng.next() < 0.3) s |= 1 << d;
  return s;
};

const inSector = (at: number, d: number) => at >= sectorStart(d) && at < sectorStart(d + 1);

describe('Slide Rule maths', () => {
  it('the count tables match brute-force enumeration of every factor sequence', () => {
    for (let j = 0; j <= 6; j++) {
      const products = allProducts(j);
      expect(products.length).toBe(sequences(j));
      for (const c of [1, 2, 7, 36, 945]) {
        const brute = new Array<number>(10).fill(0);
        for (const p of products) brute[Number(String(c * p)[0])]++;
        expect([...digitCounts(c, j)]).toEqual(brute);
      }
    }
  });

  it('the exact win chance matches a direct simulation of the raw process (4 SE)', () => {
    const cases: [DigitSet, Length][] = [
      [digitSet(1), 6],
      [digitSet(9), 2],
      [digitSet(1, 2, 3), 3],
      [digitSet(8), 5],
      [digitSet(5, 7), 4],
      [digitSet(2), 1],
      ...Object.values(VOLATILITY).map((v): [DigitSet, Length] => [v.digits, v.factors]),
    ];
    for (const [s, k] of cases) {
      const rounds = 40_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let n = 1;
        for (let i = 0; i < k; i++) n *= 2 + rng.int(8);
        if (hasDigit(s, Number(String(n)[0]))) wins++;
      }
      const p = startChance(s, k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it("Benford's law: by six factors every digit is within 0.7 points of log10(1 + 1/d)", () => {
    for (const d of DIGITS) expect(Math.abs(digitOdds(1, 6)[d] - benford(d))).toBeLessThan(0.007);
    expect(DIGITS.reduce((a, d) => a + benford(d), 0)).toBeCloseTo(1, 12);
    // One factor: each of 2…9 exactly 1/8, and 1 is impossible.
    expect(digitOdds(1, 1).slice(1)).toEqual([0, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8]);
  });

  it('each factor is a fair bet: the cash-out is the exact average of its 8 successors', () => {
    for (let trial = 0; trial < 400; trial++) {
      const { c, j } = randomState();
      const s = randomDigits();
      // In integers: the count splits exactly over the next factor.
      expect(FACTORS.reduce((a, f) => a + winCount(c * f, j - 1, s), 0)).toBe(winCount(c, j, s));
      const prize = 3.7;
      const next = FACTORS.reduce((a, f) => a + cashOut(prize, c * f, j - 1, s), 0) / 8;
      expect(next).toBeCloseTo(cashOut(prize, c, j, s), 12);
    }
    // And the round starts at RTP.
    for (const k of LENGTHS) expect(cashOut(prizeFor(digitSet(3, 4), k), 1, k, digitSet(3, 4))).toBeCloseTo(RTP, 12);
  });

  it('the drawn dial is the true leading digit: every reachable product points into its own sector', () => {
    const seen = new Set<number>();
    for (let j = 1; j <= 6; j++) for (const p of allProducts(j)) seen.add(p);
    for (const n of [...seen, 10, 100, 1000, 10000, 100000, 20, 300, 4000, 99, 999]) {
      const d = leadingDigit(n);
      expect(d).toBe(Number(String(n)[0]));
      expect(inSector(dialPosition(n), d)).toBe(true);
    }
    // Tie rule: a product on a sector line belongs to the digit that starts there.
    expect(dialPosition(20)).toBe(sectorStart(2));
    expect(dialPosition(1000)).toBe(0);
    // Multiplying is turning: the cursor moves by log10 f (mod one turn).
    for (const c of [1, 3, 84, 5040]) {
      for (const f of FACTORS) {
        const moved = (((dialPosition(c * f) - dialPosition(c) - turnFor(f)) % 1) + 1) % 1;
        expect(Math.min(moved, 1 - moved)).toBeLessThan(1e-12);
      }
    }
  });

  it('the odds on screen are the true risk: digit bars, landing fills, and lit landings on the last factor', () => {
    for (let trial = 0; trial < 300; trial++) {
      const { c, j } = randomState();
      const s = randomDigits();
      const bars = digitOdds(c, j);
      // The green bars (your digits) add up to the win chance; all bars add to 1.
      expect(DIGITS.reduce((a, d) => a + (hasDigit(s, d) ? bars[d] : 0), 0)).toBeCloseTo(winChance(c, j, s), 12);
      expect(bars.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      // Brute force from this state.
      const products = allProducts(j);
      const wins = products.filter((p) => hasDigit(s, leadingDigit(c * p))).length;
      expect(winChance(c, j, s)).toBe(wins / products.length);
      // The 8 landing dots are where the cursor really goes, and their fills average to the chance now.
      const lands = nextLandings(c, j, s);
      for (const l of lands) expect(inSector(l.at, leadingDigit(c * l.factor))).toBe(true);
      expect(lands.reduce((a, l) => a + l.chance, 0) / 8).toBeCloseTo(winChance(c, j, s), 12);
      // With one factor left, the chance is the number of landings inside your sectors, over 8.
      const lit = nextLandings(c, 1, s).filter((l) => DIGITS.some((d) => hasDigit(s, d) && inSector(l.at, d)));
      expect(lit.length / 8).toBe(winChance(c, 1, s));
      const litFactors = new Set(lit.map((l) => l.factor));
      expect(nextLandings(c, 1, s).every((l) => l.chance === (litFactors.has(l.factor) ? 1 : 0))).toBe(true);
    }
  });

  it('settings that cannot lose or cannot win are blocked; the max multiplier is 0.99 × 64', () => {
    expect(blockReason(0, 3)).toBeDefined();
    expect(blockReason(digitSet(1), 1)).toBeDefined();
    expect(blockReason(digitSet(2, 3, 4, 5, 6, 7, 8, 9), 1)).toBeDefined();
    expect(blockReason(digitSet(1), 4)).toBeUndefined();
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 64, 12);
    expect(startChance(digitSet(9), 2)).toBe(1 / 64);
    for (const k of LENGTHS) {
      for (const d of DIGITS) if (startChance(digitSet(d), k) > 0) expect(prizeFor(digitSet(d), k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
