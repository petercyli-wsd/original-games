// The exact mechanic laws (mechanics.ts) against the engine pack and the engine port.
//
// fixtures/pack-mechanics.json (gen_pack_mechanics.py): every admitted pack example on
// global_mixture whose families are a subset of {global_iid, walking_wild, expanding_wild,
// mystery_reveal, global_additive} on payline / ways / scatter_pays, and the batch games' base and
// feature specs (copied in), with `enginepack.base.analytics`.

import { describe, expect, it } from 'vitest';
import { SlotEngine } from '../engine';
import { triggerScatters } from '../index';
import { Mulberry32 } from '../rng';
import type { SlotSpec, SpinResult } from '../types';
import { distMean, distProb, distScatter, enumerationPlan, exactSpinDistribution, sampledSpinDistribution, type SpinDist } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import { spinSeeds } from './mc';
import { EXACT_FAMILIES } from './mechanics';
import { buildModel } from './model';
import fx from './fixtures/pack-mechanics.json';

interface Case {
  name: string;
  source: string;
  context: string;
  families: string[];
  tier: string;
  rtp: number;
  trigger_p: number;
  main_ev_coins: number;
  scatter_ev_coins: number;
  spec: unknown;
}
const cases = (fx as unknown as { cases: Case[] }).cases;
const byName = (n: string) => cases.find((c) => c.name === n)!;

// enumeration budgets for the test run: the pruned walks as in production; the full
// (anchor-any) enumeration of 2.1e7 boards × 20 lines takes minutes, so it is skipped here
const BUDGET = { maxFullBoards: 2e6 };
// unfold/feature.spec.json walks ~1.5e8 windows (~10 s); its base (same strips) is checked
const SLOW = new Set(['unfold/feature.spec.json']);

describe('fixture coverage', () => {
  it('every pack example with the five families and the batch games', () => {
    const pack = cases.filter((c) => c.source === 'enginepack.base.example');
    expect(pack.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pack.flatMap((c) => c.families))).toEqual(new Set(EXACT_FAMILIES));
    for (const g of ['hi-score', 'noodle-cart', 'unfold', 'grand-finale'])
      for (const f of ['slot.spec.json', 'feature.spec.json']) expect(byName(`${g}/${f}`), `${g}/${f}`).toBeTruthy();
  });
});

describe('exact RTP with mechanics = enginepack.base.analytics', () => {
  for (const c of cases) {
    it(`${c.name} (${c.context}; ${c.families.join(' + ')})`, () => {
      const spec = c.spec as SlotSpec;
      expect(buildModel(spec).closedFormRefusal).toBeNull();
      const r = exactRtp(spec);
      expect(r.tier).toBe(c.tier);
      expect(Math.abs(r.rtp - c.rtp)).toBeLessThan(1e-9);
      expect(Math.abs(r.mainEvCoins - c.main_ev_coins) / spec.bet.coins).toBeLessThan(1e-9);
      expect(Math.abs(r.scatterEvCoins - c.scatter_ev_coins) / spec.bet.coins).toBeLessThan(1e-9);
      expect(Math.abs(r.triggerP - c.trigger_p)).toBeLessThan(1e-12);
      const d = scatterCountDist(spec);
      expect(Math.abs(d.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
    });
  }
});

/** n engine-port spins (the runtime's law): coins and K as the trigger reads it. */
function engineSample(spec: SlotSpec, n: number, seed: number): { coins: Float64Array; k: Int32Array } {
  const eng = new SlotEngine(spec);
  const seeds = spinSeeds(n, seed);
  const coins = new Float64Array(n);
  const k = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = eng.spinRaw(new Mulberry32(seeds[i]));
    coins[i] = r.totalCoins;
    k[i] = triggerScatters(eng, r as unknown as SpinResult);
  }
  return { coins, k };
}

function within4se(obs: number, p: number, n: number): boolean {
  return Math.abs(obs - p) <= 4 * Math.sqrt((p * (1 - p)) / n) + 1e-12;
}

describe('exact spin distribution with mechanics: mean = exact RTP, and the engine port agrees', () => {
  for (const c of cases) {
    const spec = c.spec as SlotSpec;
    const plan = enumerationPlan(spec, BUDGET);
    if (!plan.exact || SLOW.has(c.name)) {
      it.skip(`${c.name}: ${SLOW.has(c.name) ? 'slow (checked at dev time)' : plan.method}`, () => {});
      continue;
    }
    it(c.name, () => {
      const d: SpinDist = exactSpinDistribution(spec, BUDGET);
      const bet = spec.bet.coins;
      expect(d.tier).toBe('exact');
      // summation error over up to ~1e8 walked windows reaches a few 1e-12 (unfold): 1e-10 here;
      // the closed forms above hold trigger_p to 1e-12
      const TOL = 1e-10;
      expect(Math.abs(d.p.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(TOL);
      expect(Math.abs(distMean(d) / bet - c.rtp)).toBeLessThan(1e-9);
      const sc = distScatter(d);
      const exactK = scatterCountDist(spec);
      for (let k = 0; k < Math.max(sc.length, exactK.length); k++) expect(Math.abs((sc[k] ?? 0) - (exactK[k] ?? 0))).toBeLessThan(TOL);
      const tmin = spec.trigger?.scatter_min ?? Infinity;
      expect(Math.abs(sc.reduce((a, p, k) => a + (k >= tmin ? p : 0), 0) - c.trigger_p)).toBeLessThan(TOL);

      // 200k spins through the engine port
      const n = 200_000;
      const s = engineSample(spec, n, 20261116);
      const support = new Set(d.coins.map((x, i) => `${x}|${d.k[i]}`));
      let hits = 0;
      let big = 0;
      const kObs: number[] = [];
      for (let i = 0; i < n; i++) {
        expect(support.has(`${s.coins[i]}|${s.k[i]}`), `(${s.coins[i]}, K=${s.k[i]}) outside the exact support`).toBe(true);
        if (s.coins[i] > 0) hits++;
        if (s.coins[i] >= 20 * bet) big++;
        kObs[s.k[i]] = (kObs[s.k[i]] ?? 0) + 1;
      }
      const h = distProb(d, (x) => x > 0);
      const b20 = distProb(d, (x) => x >= 20 * bet);
      expect(within4se(hits / n, h, n), `hit ${hits / n} vs ${h}`).toBe(true);
      expect(within4se(big / n, b20, n), `P(≥20×) ${big / n} vs ${b20}`).toBe(true);
      // K: each count below the trigger, and the trigger tail as one bucket
      const kmin = Number.isFinite(tmin) ? tmin : sc.length;
      for (let k = 0; k < kmin && k < sc.length; k++) expect(within4se((kObs[k] ?? 0) / n, sc[k], n), `P(K=${k})`).toBe(true);
      const tailObs = kObs.reduce((a, x, k) => a + (k >= kmin ? x ?? 0 : 0), 0) / n;
      expect(within4se(tailObs, c.trigger_p, n), `P(K≥${kmin}) ${tailObs} vs ${c.trigger_p}`).toBe(true);
    }, 60_000);
  }
});

describe('beyond enumeration: the engine port and the stop-sampling fallback agree with the exact RTP', () => {
  for (const c of cases.filter((x) => !enumerationPlan(x.spec as SlotSpec, BUDGET).exact && !SLOW.has(x.name))) {
    it(c.name, () => {
      const spec = c.spec as SlotSpec;
      const bet = spec.bet.coins;
      const n = 200_000;
      const s = engineSample(spec, n, 7);
      let m1 = 0;
      let m2 = 0;
      let trig = 0;
      const tmin = spec.trigger?.scatter_min ?? Infinity;
      for (let i = 0; i < n; i++) {
        m1 += s.coins[i] / n;
        m2 += (s.coins[i] * s.coins[i]) / n;
        if (s.k[i] >= tmin) trig++;
      }
      const se = Math.sqrt((m2 - m1 * m1) / n);
      expect(Math.abs(m1 - c.rtp * bet)).toBeLessThan(4 * se);
      expect(within4se(trig / n, c.trigger_p, n)).toBe(true);
      const d = sampledSpinDistribution(spec, n, 11);
      const mean = distMean(d);
      const sd = Math.sqrt(d.p.reduce((a, p, i) => a + p * d.coins[i] ** 2, 0) - mean * mean);
      expect(Math.abs(mean - c.rtp * bet)).toBeLessThan((4 * sd) / Math.sqrt(n));
    }, 60_000);
  }
});

describe('hi-score cross-check (builder facts: base RTP 0.6964363339, trigger 1 in 96)', () => {
  it('exact base RTP, trigger and base hit rate', () => {
    const spec = byName('hi-score/slot.spec.json').spec as SlotSpec;
    const r = exactRtp(spec);
    expect(r.rtp.toFixed(10)).toBe('0.6964363339');
    expect(Math.abs(r.triggerP - 1 / 96)).toBeLessThan(1e-12);
    const d = exactSpinDistribution(spec);
    // the global_iid multiplier never turns a loss into a win: the base hit rate is the evaluator's
    expect(distProb(d, (x) => x > 0)).toBeCloseTo(0.240312, 6);
  });
});

describe('the closed forms read the windows, not the strips', () => {
  it('a model with the strips removed gives the same RTP (payline, transformed windows)', () => {
    for (const n of ['noodle-cart/feature.spec.json', 'panel-global-additive-mult-from-wilds', 'unfold/slot.spec.json']) {
      const c = byName(n);
      const m = buildModel(c.spec as SlotSpec);
      const stripless = { ...m, components: m.components.map((comp) => ({ ...comp, strips: [] as number[][] })) };
      expect(Math.abs(exactRtp(stripless).rtp - c.rtp)).toBeLessThan(1e-9);
    }
  });
});

describe('refusals are named', () => {
  const base = byName('noodle-cart/slot.spec.json').spec as SlotSpec;
  const withMech = (mechanics: unknown[]): SlotSpec => ({ ...base, mechanics: mechanics as SlotSpec['mechanics'] });
  it('a continuation (sticky_respin) beside an exact family', () => {
    const m = buildModel(withMech([{ id: 'expanding_wild', params: { expand_law: 'full_column_on_visible_wild' } }, { id: 'sticky_respin', params: {} }]));
    expect(m.closedFormRefusal).toMatch(/sticky_respin/);
    expect(enumerationPlan(m).exact).toBe(false);
  });
  it('tumble', () => {
    expect(buildModel(withMech([{ id: 'tumble', params: {} }])).closedFormRefusal).toMatch(/tumble/);
  });
  it('global_iid terminal_total with min_steps > 1', () => {
    const m = buildModel(withMech([{ id: 'global_iid', params: { value_pmf: { '2': 1 }, apply: 'terminal_total', min_steps: 2 } }]));
    expect(m.closedFormRefusal).toMatch(/min_steps=2/);
  });
  it('two global_additive count factors', () => {
    const ga = { id: 'global_additive', params: { base: 1, value_pmf: { '1': 1 } } };
    expect(buildModel(withMech([ga, ga])).closedFormRefusal).toMatch(/quadratic/);
  });
});
