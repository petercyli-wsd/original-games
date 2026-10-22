import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COINS,
  FLIPS,
  MAX_MULTIPLIER,
  PRIORS,
  RTP,
  SEPARATIONS,
  bayesBox,
  cashOut,
  evidence,
  headlineChance,
  headsNext,
  likelihood,
  posteriorGold,
  prize,
  update,
  winChance,
  type Coin,
  type Face,
} from './math';

const rng = createRng(seededSource(29));
const flipOf = (coin: Coin, sep: (typeof SEPARATIONS)[number]): Face => (rng.next() < likelihood('H', coin, sep) ? 'H' : 'T');

describe('Bayes maths', () => {
  it('holding to the reveal wins with the prior of your coin (direct simulation)', () => {
    for (const prior of PRIORS) {
      for (const side of COINS) {
        const rounds = 40_000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const coin: Coin = rng.next() < prior ? 'gold' : 'silver';
          // The flips are shown but cannot change what the coin is.
          for (let k = 0; k < 5; k++) flipOf(coin, 'clear');
          if (coin === side) wins++;
        }
        const p = headlineChance(side, prior);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
      }
    }
  });

  it('the closed-form posterior matches the share of Gold coins among simulated rounds with the same evidence', () => {
    for (const sep of SEPARATIONS) {
      for (const prior of [0.5, 0.1] as const) {
        const k = 6;
        const gold = new Map<number, number>();
        const all = new Map<number, number>();
        for (let r = 0; r < 120_000; r++) {
          const coin: Coin = rng.next() < prior ? 'gold' : 'silver';
          let d = 0;
          for (let i = 0; i < k; i++) d += flipOf(coin, sep) === 'H' ? 1 : -1;
          all.set(d, (all.get(d) ?? 0) + 1);
          if (coin === 'gold') gold.set(d, (gold.get(d) ?? 0) + 1);
        }
        for (const [d, n] of all) {
          if (n < 400) continue;
          const p = posteriorGold(prior, sep, d);
          const seen = (gold.get(d) ?? 0) / n;
          expect(Math.abs(seen - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
        }
      }
    }
  });

  it('sequential Bayes updates equal the closed form, which depends only on heads − tails', () => {
    for (const sep of SEPARATIONS) {
      for (const prior of PRIORS) {
        for (let trial = 0; trial < 50; trial++) {
          const faces: Face[] = [];
          let p: number = prior;
          for (let i = 0; i < 20; i++) {
            const f: Face = rng.next() < 0.5 ? 'H' : 'T';
            faces.push(f);
            p = update(p, f, sep);
            expect(p).toBeCloseTo(posteriorGold(prior, sep, evidence(faces)), 9);
          }
          // Same evidence in a different order gives the same posterior.
          const shuffled = rng.shuffle(faces);
          expect(shuffled.reduce((q: number, f) => update(q, f, sep), prior as number)).toBeCloseTo(p, 9);
        }
      }
    }
  });

  it('each flip is a fair bet: E[cash-out after the flip] = cash-out now, and so is revealing', () => {
    for (let trial = 0; trial < 2000; trial++) {
      const prior = PRIORS[rng.int(PRIORS.length)];
      const sep = SEPARATIONS[rng.int(SEPARATIONS.length)];
      const side = COINS[rng.int(2)];
      const n = FLIPS[rng.int(FLIPS.length)];
      const k = rng.int(n); // flips seen so far (another one still to come)
      const d = k - 2 * rng.int(k + 1); // any reachable heads − tails
      const pGold = posteriorGold(prior, sep, d);
      const now = cashOut(side, prior, pGold);
      const pH = headsNext(pGold, sep);
      const afterFlip = pH * cashOut(side, prior, posteriorGold(prior, sep, d + 1)) + (1 - pH) * cashOut(side, prior, posteriorGold(prior, sep, d - 1));
      expect(afterFlip).toBeCloseTo(now, 12);
      // Revealing pays the prize with chance P(your coin | flips).
      expect(winChance(side, pGold) * prize(side, prior)).toBeCloseTo(now, 12);
    }
    // The round opens at exactly RTP.
    for (const prior of PRIORS) for (const side of COINS) expect(cashOut(side, prior, prior)).toBeCloseTo(RTP, 14);
  });

  it('the Bayes box on screen is the true posterior: widths now, kept areas after a flip', () => {
    for (const sep of SEPARATIONS) {
      for (const prior of PRIORS) {
        for (let d = -8; d <= 8; d++) {
          const pGold = posteriorGold(prior, sep, d);
          const still = bayesBox(pGold, sep, null);
          expect(still.gold.width).toBeCloseTo(pGold, 14);
          expect(still.gold.width + still.silver.width).toBeCloseTo(1, 14);
          expect(still.silver.x).toBeCloseTo(still.gold.width, 14);
          for (const side of COINS) expect(still[side].width).toBeCloseTo(winChance(side, pGold), 14);

          for (const face of ['H', 'T'] as const) {
            const box = bayesBox(pGold, sep, face);
            const g = box.gold.width * box.gold.height;
            const s = box.silver.width * box.silver.height;
            // The kept area is the chance of seeing this face...
            expect(g + s).toBeCloseTo(face === 'H' ? headsNext(pGold, sep) : 1 - headsNext(pGold, sep), 12);
            // ...and its Gold share is the next posterior.
            expect(g / (g + s)).toBeCloseTo(posteriorGold(prior, sep, d + (face === 'H' ? 1 : -1)), 12);

            // Sweep the box: a uniform point is a (coin, face) pair. Among the
            // points that keep the shown face, the Gold share is the posterior.
            const N = 400;
            let keptGold = 0;
            let kept = 0;
            for (let i = 0; i < N; i++) {
              const u = (i + 0.5) / N;
              const coin: Coin = u < box.gold.width ? 'gold' : 'silver';
              for (let j = 0; j < N; j++) {
                const v = (j + 0.5) / N;
                if (v < box[coin].height) {
                  kept++;
                  if (coin === 'gold') keptGold++;
                }
              }
            }
            expect(Math.abs(keptGold / kept - g / (g + s))).toBeLessThan(3 / N);
          }
        }
      }
    }
  });

  it('payouts are bounded by maxMultiplier', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(RTP / 0.02, 12);
    expect(MAX_MULTIPLIER).toBe(manifest.maxMultiplier);
    for (const prior of PRIORS) {
      for (const side of COINS) {
        expect(prize(side, prior)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
        for (const sep of SEPARATIONS) {
          for (let d = -20; d <= 20; d++) expect(cashOut(side, prior, posteriorGold(prior, sep, d))).toBeLessThanOrEqual(prize(side, prior) + 1e-12);
        }
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
