import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  RISKS,
  RISK_ORDER,
  RTP,
  autoRound,
  beats,
  cashAfter,
  effectOf,
  ladder,
  oddsStrip,
  outcomeOf,
  playThrow,
  reachChance,
  type Hand,
} from './math';

const rng = createRng(seededSource(11));
const HANDS: Hand[] = [0, 1, 2];

/** Exact chance the streak advances before it busts, by summing over throw sequences (draws replay at most `depth` times). */
function advanceChanceExact(risk: (typeof RISK_ORDER)[number], depth = 80): number {
  let p = 0;
  let replayMass = 1;
  for (let d = 0; d < depth; d++) {
    let adv = 0;
    let rep = 0;
    for (const house of HANDS) {
      const e = effectOf(risk, outcomeOf(0, house));
      if (e === 'advance') adv++;
      if (e === 'replay') rep++;
    }
    p += replayMass * (adv / 3);
    replayMass *= rep / 3;
  }
  return p;
}

describe('Rock Paper Scissors maths', () => {
  it('every hand wins against one house hand, draws one and loses to one', () => {
    for (const player of HANDS) {
      const outs = HANDS.map((house) => outcomeOf(player, house)).sort();
      expect(outs).toEqual(['draw', 'lose', 'win']);
      expect(outcomeOf(beats(player), player)).toBe('win');
    }
    expect(outcomeOf(1, 0)).toBe('win'); // paper covers rock
    expect(outcomeOf(2, 1)).toBe('win'); // scissors cut paper
    expect(outcomeOf(0, 2)).toBe('win'); // rock blunts scissors
  });

  it('the advance chance is exactly 1/factor (enumeration over throw sequences)', () => {
    for (const r of RISK_ORDER) {
      const exact = advanceChanceExact(r);
      expect(exact).toBeCloseTo(RISKS[r].p, 12);
      expect(RISKS[r].p * RISKS[r].factor).toBeCloseTo(1, 14);
    }
  });

  it('the on-screen odds strip matches the true throw odds', () => {
    for (const r of RISK_ORDER) {
      const s = oddsStrip(r);
      expect(s.advance + s.replay + s.bust).toBe(3);
      // Advancing before busting: advance / (advance + bust).
      expect(s.advance / (s.advance + s.bust)).toBeCloseTo(RISKS[r].p, 14);
    }
  });

  it('a raw simulation of throws advances before busting as often as the formula says', () => {
    for (const r of RISK_ORDER) {
      const n = 120_000;
      let adv = 0;
      for (let i = 0; i < n; i++) {
        for (;;) {
          const th = playThrow(r, rng.int(3) as Hand, rng);
          if (th.effect === 'replay') continue;
          if (th.effect === 'advance') adv++;
          break;
        }
      }
      const p = RISKS[r].p;
      expect(Math.abs(adv / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('every throw is a fair bet: E[cash-out after] = cash-out now, for every hand', () => {
    for (const r of RISK_ORDER) {
      for (let k = 0; k < RISKS[r].maxSteps; k++) {
        const now = cashAfter(r, k);
        for (const player of HANDS) {
          let e = 0;
          for (const house of HANDS) {
            const eff = effectOf(r, outcomeOf(player, house));
            e += (eff === 'advance' ? cashAfter(r, k + 1) : eff === 'replay' ? now : 0) / 3;
          }
          expect(Math.abs(e - now) / now).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('exact RTP: stopping at any streak returns exactly 99%', () => {
    for (const r of RISK_ORDER) {
      for (let k = 1; k <= RISKS[r].maxSteps; k++) {
        expect(reachChance(r, k) * cashAfter(r, k)).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('ladders are increasing and the max multiplier is honest', () => {
    for (const r of RISK_ORDER) {
      const l = ladder(r);
      expect(l[0]).toBeCloseTo(RTP * RISKS[r].factor, 12);
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1]);
      expect(l[l.length - 1]).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
    expect(ladder('classic')[0]).toBeCloseTo(1.98, 12);
    expect(MAX_MULTIPLIER).toBeCloseTo(0.99 * 2 ** 20, 6);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('an auto round resolves once, to 0 or the target cash-out, at the right rate', () => {
    for (const r of RISK_ORDER) {
      for (const target of [1, 3]) {
        const n = 20_000;
        let wins = 0;
        let total = 0;
        for (let i = 0; i < n; i++) {
          const res = autoRound(r, target, i % 4 === 3 ? 'random' : ((i % 3) as Hand), rng);
          expect(res.steps).toBe(res.throws.length);
          expect(res.steps).toBeGreaterThanOrEqual(1);
          if (res.multiplier > 0) {
            expect(res.multiplier).toBeCloseTo(cashAfter(r, target), 10);
            expect(res.throws.filter((t) => t.effect === 'advance').length).toBe(target);
            wins++;
          } else {
            expect(res.throws[res.throws.length - 1].effect).toBe('bust');
          }
          total += res.multiplier;
        }
        const p = reachChance(r, target);
        expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
        const sd = cashAfter(r, target) * Math.sqrt(p * (1 - p));
        expect(Math.abs(total / n - RTP)).toBeLessThan(4 * (sd / Math.sqrt(n)));
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
