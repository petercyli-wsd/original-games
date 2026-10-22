import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES } from './eval';
import manifest from './manifest';
import {
  DONT_RTP,
  MAX_MULTIPLIER,
  PASS_RTP,
  POINTS,
  ROLL_IDS,
  SUMS,
  WAYS,
  advance,
  betRtp,
  dontChance,
  lineReturn,
  maxOdds,
  oddsReturn,
  passChance,
  playStrategy,
  pointChance,
  rollChance,
  rollReturn,
  rollRtp,
  roundDollars,
  roundMoments,
  workingValue,
  type Point,
  type Strategy,
} from './math';

const S = (p: Partial<Strategy>): Strategy => ({ pass: 0, dontPass: 0, odds: null, props: {}, propsStay: false, field: 'double', ...p });

describe('Craps maths', () => {
  it('the dice: 36 equally likely rolls', () => {
    expect(SUMS.reduce((a, s) => a + WAYS[s], 0)).toBe(36);
  });

  it('line bets have the textbook exact odds', () => {
    expect(passChance(null)).toBeCloseTo(244 / 495, 14);
    expect(dontChance(null)).toBeCloseTo(949 / 1980, 14);
    expect(PASS_RTP).toBeCloseTo(0.985858585858, 11);
    expect(DONT_RTP).toBeCloseTo(0.986363636363, 11);
    expect(betRtp('pass', 'double')).toBeCloseTo(PASS_RTP, 14);
    expect(betRtp('dontPass', 'double')).toBeCloseTo(DONT_RTP, 14);
    expect(manifest.rtp).toBeCloseTo(488 / 495, 14);
  });

  it('pass line value is a martingale: E[value after a roll] = value now', () => {
    for (const point of [null, ...POINTS] as (Point | null)[]) {
      for (const id of ['pass', 'dontPass', 'passOdds', 'layOdds'] as const) {
        if (point === null && (id === 'passOdds' || id === 'layOdds')) continue;
        let e = 0;
        for (const s of SUMS) {
          const r = id === 'pass' || id === 'dontPass' ? lineReturn(id, point, s) : oddsReturn(id, point!, s);
          const next = advance(point, s);
          // A point set on the come-out moves the value to the new state's value.
          e += (WAYS[s] / 36) * (r ?? workingValue(id, next.point));
        }
        expect(e).toBeCloseTo(workingValue(id, point), 12);
      }
    }
  });

  it('odds behind the line pay true odds: exactly 100%', () => {
    for (const p of POINTS) {
      const w = pointChance(p);
      expect(w * oddsReturn('passOdds', p, p)!).toBeCloseTo(1, 14);
      expect((1 - w) * oddsReturn('layOdds', p, 7)!).toBeCloseTo(1, 14);
      // Lay odds are capped by what they win: the same multiple as pass odds.
      expect(maxOdds('layOdds', 1, '345x', p) * (oddsReturn('layOdds', p, 7)! - 1)).toBeCloseTo(maxOdds('passOdds', 1, '345x', p), 12);
    }
  });

  it('one-roll bets: exact RTPs and win chances', () => {
    const want: Record<string, number> = { field: 34 / 36, any7: 30 / 36, anyCraps: 32 / 36, yo: 32 / 36, aceDeuce: 32 / 36, aces: 31 / 36, twelve: 31 / 36 };
    for (const id of ROLL_IDS) expect(rollRtp(id, 'double')).toBeCloseTo(want[id], 14);
    expect(rollRtp('field', 'triple')).toBeCloseTo(35 / 36, 14);
    expect(rollChance('field')).toBeCloseTo(16 / 36, 14);
    expect(rollChance('anyCraps')).toBeCloseTo(4 / 36, 14);
    // Paytable sanity: rarer hops pay more, nothing beats the 31× cap.
    expect(rollReturn('aces', 2, 'double')).toBeGreaterThan(rollReturn('yo', 11, 'double'));
    expect(rollReturn('yo', 11, 'double')).toBeGreaterThan(rollReturn('anyCraps', 2, 'double'));
    expect(rollReturn('anyCraps', 2, 'double')).toBeGreaterThan(rollReturn('any7', 7, 'double'));
    for (const id of ROLL_IDS) for (const s of SUMS) expect(rollReturn(id, s, 'triple')).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it('the line odds match a direct simulation of the dice', () => {
    const rng = createRng(seededSource(11));
    const n = 300_000;
    let pass = 0;
    for (let i = 0; i < n; i++) {
      const { returned } = playStrategy(S({ pass: 1 }), () => 2 + rng.int(6) + rng.int(6));
      if (returned > 0) pass++;
    }
    const p = 244 / 495;
    expect(Math.abs(pass / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('roundMoments matches closed forms for flat bets', () => {
    expect(roundMoments(S({ pass: 1 })).mean).toBeCloseTo(PASS_RTP, 12);
    expect(roundMoments(S({ dontPass: 1 })).mean).toBeCloseTo(DONT_RTP, 12);
    expect(roundMoments(S({ props: { field: 1 } })).mean).toBeCloseTo(34 / 36, 12);
    expect(roundMoments(S({ props: { aces: 1 } })).sd).toBeCloseTo(31 * Math.sqrt((1 / 36) * (35 / 36)), 12);
    // A fixed wager per round: the ratio's mean is the stake-weighted RTP.
    const mixed = roundMoments(S({ pass: 3, props: { any7: 1 } })).mean;
    expect(mixed).toBeCloseTo((3 * PASS_RTP + 30 / 36) / 4, 12);
    // Pass + odds: closed form over the six points.
    for (const m of [1, 2, 5, 10] as const) {
      let e = 8 / 36 * 2;
      for (const p of POINTS) e += (WAYS[p] / 36) * (pointChance(p) * (2 + m * (1 + 6 / WAYS[p]))) / (1 + m);
      expect(roundMoments(S({ pass: 1, odds: `${m}x` as never })).mean).toBeCloseTo(e, 12);
    }
  });

  it('roundDollars: exact RTP per unit staked, matching simulation', () => {
    // Fixed stakes: the per-unit RTP is the stake-weighted bet RTP.
    expect(roundDollars(S({ pass: 3, props: { any7: 1 } })).rtp).toBeCloseTo((3 * PASS_RTP + 30 / 36) / 4, 12);
    // Odds are fair: they add stake and return equally, so the RTP moves towards 100% but stays below it.
    const flat = roundDollars(S({ pass: 1 }));
    const odds = roundDollars(S({ pass: 1, odds: '10x' }));
    expect(odds.returned - odds.wagered).toBeCloseTo(flat.returned - flat.wagered, 12);
    expect(odds.rtp).toBeGreaterThan(flat.rtp);
    const rng = createRng(seededSource(9));
    for (const fam of FAMILIES) {
      for (const st of fam.strategies) {
        const exact = roundDollars(st);
        expect(exact.rtp).toBeLessThan(1);
        const n = 40_000;
        let ret = 0;
        let wag = 0;
        const xs: number[] = [];
        for (let i = 0; i < n; i++) {
          const r = playStrategy(st, () => 2 + rng.int(6) + rng.int(6));
          ret += r.returned;
          wag += r.wagered;
          xs.push(r.returned - exact.rtp * r.wagered);
        }
        // Ratio estimator: the residuals returned − rtp·wagered have mean 0.
        const sd = Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / n);
        expect(Math.abs(ret - exact.rtp * wag) / n).toBeLessThan(4.5 * (sd / Math.sqrt(n)));
        expect(exact.wagered).toBeGreaterThan(0);
      }
    }
  });

  it('roundMoments matches simulation for every eval strategy', () => {
    const rng = createRng(seededSource(5));
    for (const fam of FAMILIES) {
      for (const st of fam.strategies) {
        const exact = roundMoments(st);
        const n = 40_000;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const r = playStrategy(st, () => 2 + rng.int(6) + rng.int(6));
          sum += r.returned / r.wagered;
        }
        expect(Math.abs(sum / n - exact.mean)).toBeLessThan(4.5 * (exact.sd / Math.sqrt(n)) + 1e-12);
      }
    }
  });

  it('simulated RTP matches each config, and the max is honest', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - r.targetRtp!)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });

  it('volatility spans low to extreme', () => {
    const sd = FAMILIES.map((f) => Math.max(...f.strategies.map((s) => roundMoments(s).sd)));
    expect(sd[3]).toBeGreaterThan(5 * Math.min(...FAMILIES[0].strategies.map((s) => roundMoments(s).sd)));
  });
});
