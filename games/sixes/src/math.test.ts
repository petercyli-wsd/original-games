import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DICE, MAX_MULTIPLIER, ROLLS, RTP, cashOutFor, dieChance, face, nextRoll, prizeFor, sixOnRoll, startChance, winChance } from './math';

const rng = createRng(seededSource(11));

describe('Sixes maths', () => {
  it('the card figures: 42.1%, 17.7%, 7.5%, 3.2%, 1.33% for 1 to 5 dice', () => {
    expect(startChance(1)).toBeCloseTo(91 / 216, 14);
    const want = [0.4213, 0.1775, 0.0748, 0.0315, 0.0133];
    DICE.forEach((n, i) => expect(startChance(n)).toBeCloseTo(want[i], 4));
    expect(startChance(1) / startChance(5)).toBeGreaterThan(25);
  });

  it('faces are uniform from 1 to 6', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const N = 120_000;
    for (let i = 0; i < N; i++) counts[face(rng.next()) - 1]++;
    for (const c of counts) expect(Math.abs(c / N - 1 / 6)).toBeLessThan(4 * Math.sqrt((1 / 6) * (5 / 6) / N));
    expect(face(0)).toBe(1);
    expect(face(0.999999999)).toBe(6);
  });

  it('a die bar is the sum of its per-roll pieces: 1/6, 5/36, 25/216', () => {
    for (let r = 0; r <= ROLLS; r++) {
      let s = 0;
      for (let k = 1; k <= r; k++) s += sixOnRoll(k);
      expect(dieChance(r)).toBeCloseTo(s, 14);
    }
  });

  it('the bars multiply to the win chance, and that matches a direct simulation of the dice', () => {
    for (let free = 1; free <= 5; free++) {
      for (let r = 1; r <= ROLLS; r++) {
        // What the board draws: one bar per free die, full bars for the sixes.
        const bars = [...Array(free).fill(dieChance(r)), 1, 1];
        expect(bars.reduce((a, b) => a * b, 1)).toBeCloseTo(winChance(free, r), 14);

        const rounds = 40_000;
        let wins = 0;
        for (let t = 0; t < rounds; t++) {
          let f = free;
          for (let k = 0; k < r && f > 0; k++) {
            let six = 0;
            for (let i = 0; i < f; i++) if (face(rng.next()) === 6) six++;
            f -= six;
          }
          if (f === 0) wins++;
        }
        const p = winChance(free, r);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('the next-roll outcomes cover every case and average back to the chance now (martingale)', () => {
    for (const n of DICE) {
      for (let free = 1; free <= n; free++) {
        for (let r = 1; r <= ROLLS; r++) {
          const outs = nextRoll(free, r);
          expect(outs.reduce((a, o) => a + o.prob, 0)).toBeCloseTo(1, 14);
          const now = cashOutFor(n, free, r);
          const after = outs.reduce((a, o) => a + o.prob * cashOutFor(n, free - o.sixes, r - 1), 0);
          expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
          expect(outs.reduce((a, o) => a + o.prob * o.win, 0)).toBeCloseTo(winChance(free, r), 14);
          // A roll is never certain to lose while a roll is left.
          expect(outs.some((o) => o.win > 0)).toBe(true);
        }
      }
    }
  });

  it('the next-roll outcome odds match simulated rolls', () => {
    const free = 4;
    const outs = nextRoll(free, 2);
    const N = 100_000;
    const counts = new Array(free + 1).fill(0);
    for (let t = 0; t < N; t++) {
      let six = 0;
      for (let i = 0; i < free; i++) if (face(rng.next()) === 6) six++;
      counts[six]++;
    }
    outs.forEach((o, k) => expect(Math.abs(counts[k] / N - o.prob)).toBeLessThan(4 * Math.sqrt((o.prob * (1 - o.prob)) / N) + 1e-4));
  });

  it('the cash-out starts at the RTP and a full win pays the prize', () => {
    for (const n of DICE) {
      expect(cashOutFor(n, n, ROLLS)).toBeCloseTo(RTP, 12);
      expect(cashOutFor(n, 0, 1)).toBeCloseTo(prizeFor(n), 12);
      expect(cashOutFor(n, 1, 0)).toBe(0);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(prizeFor(5), 12);
  });

  it('simulated RTP matches the manifest under mixed strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });
});
