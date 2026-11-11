import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { FULL, KS, RTP, TOTALS, advance, cashOf, greenCells, light, popcount, prizeFor, waysOf, winChance } from './math';

const SEVEN = 6;
const open = (mask: number, t: number) => !(mask & (1 << (TOTALS as readonly number[]).indexOf(t)));

describe('Seven Out fairness', () => {
  it('martingale (exact): enumerating every outcome of a step, E[cash after] = cash now, at every reachable lit set and k', () => {
    let states = 0;
    for (const k of KS)
      for (let mask = 0; mask <= FULL; mask++) {
        if (popcount(mask) >= k) continue;
        const g = greenCells(mask);
        // The step's outcomes: a 7 (cash 0) or one unlit total.
        let ev = (SEVEN / (g + SEVEN)) * cashOf(k, mask, true);
        for (const t of TOTALS) if (open(mask, t)) ev += (waysOf(t) / (g + SEVEN)) * cashOf(k, light(mask, t), false);
        expect(Math.abs(ev - cashOf(k, mask, false))).toBeLessThan(1e-12 * prizeFor(k));
        states++;
      }
    expect(states).toBeGreaterThan(1000);
  });

  it('optimal play (exact): the Snell envelope over {cash out, roll} equals the cash-out everywhere', () => {
    for (const k of KS) {
      const prize = prizeFor(k);
      const U = new Float64Array(FULL + 1);
      let worst = 0;
      for (let mask = FULL; mask >= 0; mask--) {
        const v = cashOf(k, mask, false);
        if (popcount(mask) >= k) {
          U[mask] = prize;
          continue;
        }
        const g = greenCells(mask);
        let roll = 0;
        for (const t of TOTALS) if (open(mask, t)) roll += (waysOf(t) / (g + SEVEN)) * U[light(mask, t)];
        U[mask] = Math.max(v, roll);
        worst = Math.max(worst, (U[mask] - v) / prize);
      }
      expect(worst).toBeLessThan(1e-12);
      expect(U[0] / prize / winChance(k, 0)).toBeCloseTo(1, 12);
    }
  });

  it('hostile strategies on the real advance(): every one within 4 SE of RTP', () => {
    const rng = createRng(seededSource(99));
    const rounds = 40000;
    type Stop = (k: number, mask: number, steps: number, r: Rng) => boolean;
    const strategies: [string, Stop][] = [
      ['play to the end', () => false],
      ['cash out once a roll is >= 80% safe is not met: stop when the next roll that counts is < 80% new', (_k, m) => greenCells(m) / (greenCells(m) + SEVEN) < 0.8],
      ['cash out the moment cash exceeds the stake', (k, m) => cashOf(k, m, false) > 1],
      ['stop after two steps', (_k, _m, s) => s >= 2],
    ];
    for (const [name, stop] of strategies)
      for (const k of KS) {
        let s = 0;
        let s2 = 0;
        for (let i = 0; i < rounds; i++) {
          let mask = 0;
          let steps = 0;
          let x = 0;
          for (;;) {
            const r = advance(mask, rng);
            steps++;
            if (r.rolls[r.rolls.length - 1].kind === 'seven') {
              x = 0;
              break;
            }
            mask = r.mask;
            x = cashOf(k, mask, false);
            if (popcount(mask) >= k || stop(k, mask, steps, rng)) break;
          }
          s += x;
          s2 += x * x;
        }
        const mean = s / rounds;
        const se = Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds);
        expect(Math.abs(mean - RTP), `${name}, k = ${k}`).toBeLessThan(4 * se + 1e-9);
      }
  });
});
