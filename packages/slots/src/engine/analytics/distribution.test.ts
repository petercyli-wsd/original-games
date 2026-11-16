import { describe, expect, it } from 'vitest';
import type { SlotSpec } from '../types';
import { distMean, distProb, distScatter, distSecondMoment, enumerationPlan, exactSpinDistribution, sampledSpinDistribution } from './distribution';
import { exactRtp } from './exact';
import pack from './fixtures/pack-analytics.json';

interface ExactCase {
  panel: string;
  rtp: number;
  trigger_p: number;
  spec: unknown;
  spins: { board: number[][]; totalCoins: number }[];
}
const cases = (pack as unknown as { exact: ExactCase[] }).exact;

describe('exact spin distribution (enumeration) agrees with the closed forms', () => {
  for (const c of cases) {
    const spec = c.spec as SlotSpec;
    const plan = enumerationPlan(spec);
    if (!plan.exact) {
      it.skip(`${c.panel}: ${plan.method}`, () => {});
      continue;
    }
    it(c.panel, () => {
      const d = exactSpinDistribution(spec);
      expect(d.tier).toBe('exact');
      expect(Math.abs(d.p.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
      // mean = the pack's exact RTP; the scatter marginal's tail = the pack's trigger_p
      expect(Math.abs(distMean(d) / spec.bet.coins - c.rtp)).toBeLessThan(1e-9);
      const sc = distScatter(d);
      const tmin = spec.trigger?.scatter_min ?? Infinity;
      expect(Math.abs(sc.reduce((a, p, k) => a + (k >= tmin ? p : 0), 0) - c.trigger_p)).toBeLessThan(1e-12);
      // every pack spin's (coins) is in the support
      const support = new Set(d.coins);
      for (const s of c.spins) expect(support.has(s.totalCoins)).toBe(true);
      // the 300 pack spins' hit rate sits within 4 SE of the exact hit rate
      const h = distProb(d, (x) => x > 0);
      const obs = c.spins.filter((s) => s.totalCoins > 0).length / c.spins.length;
      expect(Math.abs(obs - h)).toBeLessThan(4 * Math.sqrt((h * (1 - h)) / c.spins.length) + 1e-12);
    }, 120_000);
  }
});

describe('stop-sampling Monte Carlo agrees with the closed form within 4 SE', () => {
  for (const c of cases.filter((x) => !enumerationPlan(x.spec as SlotSpec).exact || x.panel === 'panel-plain-ways-substitution-no-overlay')) {
    it(c.panel, () => {
      const spec = c.spec as SlotSpec;
      const n = 200_000;
      const d = sampledSpinDistribution(spec, n, 7);
      expect(d.tier).toBe('mc');
      expect(d.n).toBe(n);
      const mean = distMean(d);
      const se = Math.sqrt((distSecondMoment(d) - mean * mean) / n);
      expect(Math.abs(mean - exactRtp(spec).rtp * spec.bet.coins)).toBeLessThan(4 * se);
    }, 120_000);
  }
});
