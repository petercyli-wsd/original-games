import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOARD,
  DRAWS,
  MAX_MULTIPLIER,
  MAX_PICKS,
  PAYTABLE,
  RISKS,
  RTP,
  TOTAL_DRAWS,
  choose,
  countHits,
  drawNumbers,
  drawsWithHits,
  hitChance,
  payRows,
  payout,
  playKeno,
  profitChance,
  randomPicks,
  stdDev,
  tableRtp,
  tableRtpFraction,
} from './math';

const PICKS = Array.from({ length: MAX_PICKS }, (_, i) => i + 1);

describe('Keno maths', () => {
  it('C(40,10) and the hypergeometric counts add up', () => {
    expect(TOTAL_DRAWS).toBe(847_660_528);
    for (const n of PICKS) {
      let total = 0;
      for (let k = 0; k <= n; k++) total += drawsWithHits(n, k);
      expect(total).toBe(TOTAL_DRAWS);
    }
  });

  it('every one of the 40 tables returns exactly 99% (integer arithmetic)', () => {
    for (const risk of RISKS) {
      expect(PAYTABLE[risk]).toHaveLength(MAX_PICKS);
      for (const n of PICKS) {
        expect(PAYTABLE[risk][n - 1]).toHaveLength(n + 1);
        const { num, den } = tableRtpFraction(risk, n);
        // num / den = 99 / 100 exactly  <=>  100·num = 99·den
        expect(100n * num).toBe(99n * den);
        expect(tableRtp(risk, n)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('paytables are sane: non-negative, non-decreasing in hits, top prize is the most', () => {
    for (const risk of RISKS) {
      for (const n of PICKS) {
        const row = PAYTABLE[risk][n - 1];
        for (let k = 0; k <= n; k++) {
          expect(Number.isInteger(row[k]) && row[k] >= 0).toBe(true);
          if (k > 0) expect(row[k]).toBeGreaterThanOrEqual(row[k - 1]);
        }
        expect(row[n]).toBe(Math.max(...row));
        expect(row[n]).toBeGreaterThan(100);
      }
    }
  });

  it('the max multiplier is honest', () => {
    const top = Math.max(...RISKS.flatMap((r) => PICKS.map((n) => payout(r, n, n))));
    expect(MAX_MULTIPLIER).toBe(top);
    expect(manifest.maxMultiplier).toBe(top);
  });

  it('the draw is 10 distinct numbers from 1–40, uniform over the board', () => {
    const rng = createRng(seededSource(11));
    const freq = new Array(BOARD + 1).fill(0);
    const n = 40_000;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const d = drawNumbers(rng);
      if (d.length !== DRAWS || new Set(d).size !== DRAWS) bad++;
      for (const x of d) {
        if (!(x >= 1 && x <= BOARD)) bad++;
        freq[x]++;
      }
    }
    expect(bad).toBe(0);
    const p = DRAWS / BOARD;
    for (let x = 1; x <= BOARD; x++) expect(Math.abs(freq[x] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('simulated hit counts match the hypergeometric chances shown in the table', () => {
    const rng = createRng(seededSource(5));
    const n = 120_000;
    for (const picks of [1, 4, 7, 10]) {
      const chosen = randomPicks(rng, picks);
      const freq = new Array(picks + 1).fill(0);
      for (let i = 0; i < n; i++) freq[countHits(chosen, drawNumbers(rng))]++;
      for (let k = 0; k <= picks; k++) {
        const p = hitChance(picks, k);
        expect(Math.abs(freq[k] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
      }
      // The rows on screen are the same numbers.
      payRows('classic', picks).forEach((r) => expect(r.chance).toBe(hitChance(picks, r.hits)));
    }
  });

  it('closed-form spot checks', () => {
    expect(hitChance(1, 1)).toBeCloseTo(1 / 4, 15);
    expect(hitChance(10, 10)).toBeCloseTo(1 / TOTAL_DRAWS, 20);
    expect(hitChance(2, 2)).toBeCloseTo((choose(38, 8) / TOTAL_DRAWS), 15);
    expect(hitChance(2, 2)).toBeCloseTo((10 * 9) / (40 * 39), 15);
    expect(profitChance('high', 1)).toBeCloseTo(0.25, 15);
  });

  it('simulated RTP of individual tables matches 99% (4 SE)', () => {
    const rng = createRng(seededSource(21));
    const n = 150_000;
    for (const [risk, picks] of [['low', 3], ['classic', 6], ['medium', 2], ['high', 4]] as const) {
      let s = 0;
      const chosen = randomPicks(rng, picks);
      for (let i = 0; i < n; i++) s += playKeno(rng, risk, chosen).multiplier;
      expect(Math.abs(s / n - RTP)).toBeLessThan(4 * (stdDev(risk, picks) / Math.sqrt(n)));
    }
  });

  it('Auto play resolves one round per call, with re-pick giving fresh numbers', () => {
    const rng = createRng(seededSource(9));
    const r1 = playKeno(rng, 'classic', [3, 9, 27]);
    expect(r1.picks).toEqual([3, 9, 27]);
    expect(r1.drawn).toHaveLength(DRAWS);
    expect(r1.multiplier).toBe(payout('classic', 3, r1.hits));
    const r2 = playKeno(rng, 'high', [], 6);
    expect(r2.picks).toHaveLength(6);
    expect(new Set(r2.picks).size).toBe(6);
    expect(r2.hits).toBe(countHits(r2.picks, r2.drawn));
    expect(r2.multiplier).toBe(payout('high', 6, r2.hits));
  });

  it('risk spreads volatility widely at the same RTP', () => {
    expect(stdDev('high', 6) / stdDev('low', 1)).toBeGreaterThan(25);
  });

  it('eval RTP matches the manifest and stays under the max', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[3].stdDev / reports[0].stdDev).toBeGreaterThan(5);
  });
});
