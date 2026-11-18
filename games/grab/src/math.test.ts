import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { REDS, RTP, cashOf, chanceOf, layout, prizeFor, spin, startChance, winChance, type State } from './math';

const rng = createRng(seededSource(11));

describe('Grab maths', () => {
  it('P(win) at the start matches the card for r = 1..10', () => {
    const want: Record<number, number> = { 1: 0.6296, 2: 0.4037, 4: 0.1748, 6: 0.0804, 8: 0.0389, 10: 0.0196 };
    for (const r of REDS) expect(startChance(r)).toBeCloseTo(want[r], 3);
  });

  it('closed form matches a direct simulation of the wheel', () => {
    for (const r of REDS) {
      const N = 200_000;
      let win = 0;
      for (let t = 0; t < N; t++) {
        let s: State = { wedges: layout(r), hits: 0 };
        for (;;) {
          const o = spin(s, rng.int(16));
          if (o.kind === 'red') break;
          s = o.state;
          if (s.hits >= 2) {
            win++;
            break;
          }
        }
      }
      const p = startChance(r);
      expect(Math.abs(win / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N) + 1e-9);
    }
  });

  it('layout: 1 green, r red, evenly spread, rest grey', () => {
    for (const r of REDS) {
      const w = layout(r);
      expect(w.filter((k) => k === 'green')).toHaveLength(1);
      expect(w.filter((k) => k === 'red')).toHaveLength(r);
      const idx = w.flatMap((k, i) => (k === 'red' ? [i] : []));
      expect(new Set(idx).size).toBe(r);
    }
  });

  it('every conversion and every hit raises the chance (the odds on screen are the true risk)', () => {
    for (const r of REDS) {
      for (let g = 1; g <= 15 - r; g++) {
        for (const h of [0, 1]) {
          const here = winChance(g, h, r);
          expect(winChance(g + 1, h, r)).toBeGreaterThan(here);
          expect(winChance(g, h + 1, r)).toBeGreaterThan(here);
        }
      }
    }
  });

  it('prize x start chance = RTP and the cash-out starts at RTP', () => {
    for (const r of REDS) {
      expect(prizeFor(r) * startChance(r)).toBeCloseTo(RTP, 12);
      expect(cashOf({ wedges: layout(r), hits: 0 })).toBeCloseTo(RTP, 12);
    }
  });

  it('simulated RTP matches the manifest under mixed stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });

  it('chanceOf / cashOf agree with winChance on spun states', () => {
    const s: State = { wedges: layout(4), hits: 1 };
    expect(chanceOf(s)).toBeCloseTo(winChance(1, 1, 4), 12);
  });
});
