import { describe, expect, it } from 'vitest';
import type { SlotSpec } from '../types';
import { exactRtp, scatterCountDist, triggerProbability } from './exact';
import { boardCoins, buildModel } from './model';
import pack from './fixtures/pack-analytics.json';

interface ExactCase {
  panel: string;
  context: string;
  tier: string;
  rtp: number;
  trigger_p: number;
  main_ev_coins: number;
  scatter_ev_coins: number;
  spec: unknown;
  spins: { seed: number; set: number; stops: number[]; board: number[][]; totalCoins: number }[];
}

const cases = (pack as unknown as { exact: ExactCase[] }).exact;

describe('exact base RTP = enginepack.base.analytics (fixtures/pack-analytics.json)', () => {
  it('covers every no-mechanic payline / ways / scatter_pays example on global_mixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
    const kinds = new Set(cases.map((c) => c.context.split('|')[0]));
    expect([...kinds].sort()).toEqual(['payline', 'scatter_pays', 'ways']);
  });

  for (const c of cases) {
    it(`${c.panel} (${c.context})`, () => {
      const spec = c.spec as SlotSpec;
      const r = exactRtp(spec);
      expect(r.tier).toBe(c.tier);
      expect(Math.abs(r.rtp - c.rtp)).toBeLessThan(1e-9);
      expect(Math.abs(r.mainEvCoins - c.main_ev_coins) / spec.bet.coins).toBeLessThan(1e-9);
      expect(Math.abs(r.scatterEvCoins - c.scatter_ev_coins) / spec.bet.coins).toBeLessThan(1e-9);
      expect(Math.abs(r.triggerP - c.trigger_p)).toBeLessThan(1e-12);
      // the scatter-count distribution: a pmf, and its tail is the pack's trigger_p
      const d = scatterCountDist(spec);
      expect(Math.abs(d.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(triggerProbability(spec) - c.trigger_p)).toBeLessThan(1e-12);
    });
  }
});

describe('board evaluator = the pack, coin for coin, on 300 seeded spins per example', () => {
  for (const c of cases) {
    it(c.panel, () => {
      const m = buildModel(c.spec as SlotSpec);
      for (const s of c.spins) {
        expect(boardCoins(m, s.board).coins, `seed ${s.seed}`).toBe(s.totalCoins);
      }
    });
  }
});
