// The runtime API: createSlot / spin / playRound (free spins by the analytics/config.ts law) and the
// max-win cap. The base and feature boards are pack spins (parity.test.ts); this tests the round law.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { award, multiplierAt, type FreeSpinsConfig } from './analytics/config';
import { createSlot, triggerScatters, type SlotSpec } from './index';
import type { OracleFixture } from './parity';
import { Mulberry32 } from './rng';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => JSON.parse(gunzipSync(readFileSync(join(dir, `${name}.json.gz`))).toString('utf8')) as OracleFixture;
const base = fixture('plain-line-eval-no-modifier');
const spec = base.spec;

/** A feature spec: the same game with every scatter pay doubled (any pack-verified spec works). */
const featureSpec: SlotSpec = { ...spec, slug: 'feature', pays: { ...spec.pays, scatter_pay: Object.fromEntries(Object.entries(spec.pays.scatter_pay ?? {}).map(([k, v]) => [k, v * 2])) } };

const feature: FreeSpinsConfig = {
  kind: 'free_spins',
  spec: 'feature.spec.json',
  awards: { '3': 8, '4': 12, '5': 20 },
  retrigger: { '3': 5 },
  maxSpins: 30,
  multiplier: { kind: 'per_retrigger', start: 1, step: 1 },
};

const probe = createSlot({ spec, maxWinStakes: 5000 });
/** Base seeds whose spin triggers (base spins equal the pack's: parity.test.ts). */
function triggeringSeeds(n: number): number[] {
  const out: number[] = [];
  for (let s = 0; out.length < n && s < 200_000; s++) if (probe.spin(s).trigger?.fired) out.push(s);
  return out;
}

describe('createSlot', () => {
  const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature, maxWinStakes: 5000 });

  it('spin(seed) is the pack spin', () => {
    for (let s = 0; s < 50; s++) expect(slot.spin(s)).toEqual(base.spins[s]);
  });

  it('a round without a trigger is the base spin', () => {
    const s = base.spins.findIndex((x) => x.trigger === null && x.totalCoins > 0);
    const r = slot.playRound(s);
    expect(r.feature).toBeNull();
    expect(r.totalCoins).toBe(base.spins[s].totalCoins);
    expect(r.capped).toBe(false);
  });

  it('a triggering round plays the awarded free spins by the config law, replayable from its seeds', () => {
    const seeds = triggeringSeeds(120);
    expect(seeds.length).toBe(120);
    let paying = 0;
    let retriggered = 0;
    let multiplied = 0;
    for (const s of seeds) {
      const host = new Mulberry32(1000 + s); // stands in for the host's crypto RNG
      const r = slot.playRound(s, () => host.u32());
      const k = triggerScatters(slot.engine, r.base);
      expect(r.feature).not.toBeNull();
      const f = r.feature!;
      // replay: each free spin is the feature spec's spin on its own seed
      let granted = Math.min(award(feature.awards, k), feature.maxSpins);
      let retriggers = 0;
      let total = r.base.totalCoins;
      f.spins.forEach((sp, i) => {
        expect(slot.featureEngine!.spin(sp.seed!)).toEqual(sp.result);
        expect(sp.multiplier).toBe(multiplierAt(feature.multiplier, i + 1, retriggers));
        expect(sp.coins).toBe(sp.result.totalCoins * sp.multiplier);
        const a = award(feature.retrigger, triggerScatters(slot.featureEngine!, sp.result));
        expect(sp.retrigger).toBe(Math.min(a, feature.maxSpins - granted));
        granted += sp.retrigger;
        if (a > 0) retriggers++;
        if (sp.coins > 0) paying++;
        if (sp.retrigger > 0) retriggered++;
        if (sp.multiplier > 1 && sp.coins > 0) multiplied++;
        total += sp.coins;
      });
      expect(f.spins.length).toBe(granted);
      expect(f.totalCoins).toBe(f.spins.reduce((a, x) => a + x.coins, 0));
      expect(r.totalCoins).toBe(total);
    }
    // the law was exercised, not just an empty loop
    expect(paying).toBeGreaterThan(50);
    expect(retriggered).toBeGreaterThan(0);
    expect(multiplied).toBeGreaterThan(0);
  });

  it('the max-win cap ends the round and pays the cap', () => {
    const s = triggeringSeeds(1)[0];
    const tiny = createSlot({ spec, featureSpecs: { feature: featureSpec }, feature, maxWinStakes: 0.5 });
    const host = new Mulberry32(99);
    const r = tiny.playRound(s, () => host.u32());
    expect(r.capped).toBe(true);
    expect(r.totalCoins).toBe(tiny.maxWinCoins);
    expect(tiny.maxWinCoins).toBe(Math.floor(0.5 * spec.bet.coins));
  });

  it('refuses what it cannot run exactly', () => {
    expect(() => createSlot({ spec, feature, maxWinStakes: 5000 })).toThrow(/feature spec/);
    expect(() => createSlot({ spec, featureSpecs: { feature: featureSpec }, feature: { ...feature, multiplier: { kind: 'constant', value: 1.5 } }, maxWinStakes: 5000 })).toThrow(/integer/);
    const bad = { ...spec, mechanics: [{ id: 'fish_catch_collect', params: {} }] } as SlotSpec;
    expect(() => createSlot({ spec: bad, maxWinStakes: 5000 })).toThrow(/not ported/);
    const s = triggeringSeeds(1)[0];
    expect(() => createSlot({ spec, featureSpecs: { feature: featureSpec }, feature, maxWinStakes: 5000 }).playRound(s)).toThrow(/rng32/);
  });
});
