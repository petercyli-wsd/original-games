// Fairness audit: can any way of playing Thales beat the RTP?
//
// A round backs Acute or Obtuse for a series of 1–3 triangles in an arena; all
// three settings are locked while live. Each triangle has two reveals, each
// drawn from the host rng when its button is pressed: A and B land (a
// checkpoint, cash-out = prize · r(A, B) · p^rest), then C lands (win: the next
// checkpoint or the prize; lose: 0). The only decision is when to stop. Cash
// out is offered only at 'landed' and 'between'; during a drop the panel shows
// a disabled Bet button and the hotkeys check the phase, so a result cannot be
// dodged mid-animation, and C is never drawn before the player presses Drop C.
// When C cannot go either way (r ∈ {0, 1}) the game drops it on its own.
//
// The claim "cash out whenever C is under 80% to land your way" fails exactly
// when the cash-out is a martingale:
//   - at a 'landed' state, P(C on your side | A, B) = r(A, B), the shaded share
//     drawn on the board; checked by 100k real C draws (samplePoint + onSide)
//     at ≥ 30 states from real rounds on every arena and side, including
//     near-sure pairs (r close to 0 or 1), 4 SE;
//   - before A and B land (bet, or between triangles), E[r(A, B)] = p, the
//     headline chance; checked by 100k real A, B pairs per arena, 4 SE (the
//     triangle arena's p is a quadrature constant).
//
// Strategies on every eval config:
//   (a) the tester's: drop C only when r ≥ 0.8, else cash out (the A, B drop
//       carries no risk, so it is always taken);
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play every triangle to the end;
//   (d) use what A and B show: cash out when r(A, B) is below the headline p
//       (a "bad pair"), keep only good pairs; and its mirror, run only bad
//       pairs (cash out when r ≥ p), the highest-variance choice.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  ARENAS,
  MAX_MULTIPLIER,
  RTP,
  SIDES,
  acuteChance,
  acuteShare,
  cashOutValue,
  onSide,
  prizeOf,
  samplePoint,
  sideChance,
  sideShare,
  type Pt,
  type Settings,
} from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

const point = (s: Pick<Settings, 'arena'>, rng: Rng): Pt => samplePoint(s.arena, rng.next(), rng.next());

/**
 * Stop rule at a checkpoint: k triangles settled, `r` the chance for the
 * current C (null between triangles), `cash` the cash-out.
 */
type Stop = (s: Settings, k: number, r: number | null, cash: number) => boolean;

/** One round as Game.tsx plays it (dropAB → checkpoint → dropC → …), outcomes from the raw process. */
function playRound(s: Settings, rng: Rng, stop: Stop): number {
  for (let k = 0; k < s.series; k++) {
    if (k > 0) {
      const cash = cashOutValue(s, { settled: k, ab: null });
      if (stop(s, k, null, cash)) return cash;
    }
    const a = point(s, rng);
    const b = point(s, rng);
    const r = sideShare(s, a, b);
    if (r > 0 && r < 1) {
      const cash = cashOutValue(s, { settled: k, ab: [a, b] });
      if (stop(s, k, r, cash)) return cash;
    }
    if (!onSide(s.side, a, b, point(s, rng))) return 0;
  }
  return prizeOf(s);
}

describe('Thales fairness', () => {
  it('martingale at A, B down: 100k real C draws land on your side with chance r(A, B), so E[V after C] = V (4 SE)', () => {
    const rng = createRng(seededSource(31));
    let states = 0;
    for (const arena of ARENAS) {
      for (const side of SIDES) {
        const s: Settings = { arena, side, series: 2 };
        const pairs: [Pt, Pt][] = [];
        for (let i = 0; i < 4; i++) pairs.push([point(s, rng), point(s, rng)]);
        // A near-sure pair: A and B close together (a thin band, so r is near 0 for Acute and near 1 for Obtuse).
        const a = point(s, rng);
        pairs.push([a, { x: a.x * 0.97, y: a.y * 0.97 }]);
        for (const [a, b] of pairs) {
          const r = sideShare(s, a, b);
          // On the last triangle V = prize · r, and after C it is the prize or 0.
          expect(cashOutValue(s, { settled: 1, ab: [a, b] })).toBeCloseTo(prizeOf(s) * r, 9);
          const N = 100_000;
          let hits = 0;
          for (let i = 0; i < N; i++) if (onSide(side, a, b, point(s, rng))) hits++;
          const se = Math.sqrt(Math.max(r * (1 - r), 1 / N) / N);
          expect(Math.abs(hits / N - r)).toBeLessThan(4 * se);
          const v = cashOutValue(s, { settled: 0, ab: [a, b] });
          const after = (hits / N) * cashOutValue(s, { settled: 1, ab: null });
          expect(Math.abs(after - v)).toBeLessThan(4 * se * cashOutValue(s, { settled: 1, ab: null }));
          states++;
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('martingale before A, B land: E[r(A, B)] over 100k real pairs = the headline p on every arena (4 SE), so E[V after A, B] = V', () => {
    const rng = createRng(seededSource(32));
    for (const arena of ARENAS) {
      const N = 100_000;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const r = acuteShare(arena, point({ arena }, rng), point({ arena }, rng));
        s1 += r;
        s2 += r * r;
      }
      const m = s1 / N;
      const se = Math.sqrt((s2 / N - m * m) / N);
      expect(Math.abs(m - acuteChance(arena))).toBeLessThan(4 * se);
      // Obtuse is 1 − acute on the same pairs, so it passes with the same z.
      for (const side of SIDES) {
        const s: Settings = { arena, side, series: 3 };
        const p = sideChance(s);
        for (let k = 0; k < 3; k++) {
          const before = cashOutValue(s, { settled: k, ab: null });
          // E[V after A, B] = prize · E[r] · p^(n−k−1); with E[r] = p it is V.
          expect(prizeOf(s) * p * p ** (3 - k - 1)).toBeCloseTo(before, 9);
        }
      }
    }
  });

  it('cash-outs never exceed the prize, and the prize never exceeds maxMultiplier', () => {
    const rng = createRng(seededSource(33));
    for (let n = 0; n < 2000; n++) {
      const s = evalSpec.configs[rng.int(evalSpec.configs.length)].params;
      const a = point(s, rng);
      const b = point(s, rng);
      for (let k = 0; k < s.series; k++) expect(cashOutValue(s, { settled: k, ab: [a, b] })).toBeLessThanOrEqual(prizeOf(s) * (1 + 1e-12));
      expect(prizeOf(s)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE', () => {
    const rules: [string, Stop][] = [
      ['(a) drop C only if r ≥ 0.8', (_s, _k, r) => r !== null && r < 0.8],
      ['(b) any profit', (_s, _k, _r, cash) => cash > 1],
      ['(c) to the end', () => false],
      ['(d) keep good pairs (cash if r < p)', (s, _k, r) => r !== null && r < sideChance(s)],
      ['(d) keep bad pairs (cash if r ≥ p)', (s, _k, r) => r !== null && r >= sideChance(s)],
    ];
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, i) => {
      rules.forEach(([name, stop], j) => {
        const rng = createRng(seededSource(1000 + 10 * i + j));
        let s1 = 0;
        let s2 = 0;
        let max = 0;
        for (let n = 0; n < ROUNDS; n++) {
          const m = playRound(cfg.params, rng, stop);
          s1 += m;
          s2 += m * m;
          max = Math.max(max, m);
        }
        const mean = s1 / ROUNDS;
        const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${name.padEnd(38)} ${cfg.label.padEnd(36)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / se).toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
