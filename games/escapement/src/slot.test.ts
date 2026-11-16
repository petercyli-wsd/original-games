// Escapement: maths and flow tests. The oracle (oracle.json, from the engine pack) pins every board;
// the feature's algebra is checked against Monte Carlo of playRound within 4 SE.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSlot, canonicalSpin, triggerScatters, type SlotSpec } from '@originals/slots';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { empiricalDist, distScatter } from '../../../packages/slots/src/engine/analytics/distribution';
import { distRtpReport, spinScatterCount } from '../../../packages/slots/src/engine/analytics/mc';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import { validateSlotConfig, type SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { Mulberry32 } from '../../../packages/slots/src/engine/rng';
import oracle from './oracle.json';
import facts from './slot-facts.json';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const spec = read('slot.spec.json') as SlotSpec;
const featureSpec = read('feature.spec.json') as SlotSpec;
const config = read('slot.config.json') as SlotConfig;
const B = spec.bet.coins;

const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: config.feature!, maxWinStakes: config.maxWinStakes });

describe('config and spec', () => {
  it('the config is valid and both specs share the stake', () => {
    expect(validateSlotConfig(config)).toEqual([]);
    expect(featureSpec.bet.coins).toBe(B);
    expect(config.volatility).toBe('medium');
  });
  it('the winding is a sticky respin on a 5x3, 20-line board with expanding pendulums', () => {
    expect(spec.evaluation.kind).toBe('payline');
    expect(spec.evaluation.paylines).toHaveLength(20);
    expect(spec.mechanics.map((m) => m.id)).toEqual(['expanding_wild', 'sticky_respin']);
    expect(featureSpec.mechanics.map((m) => m.id)).toEqual(['expanding_wild', 'sticky_respin']);
  });
});

describe('oracle parity (engine pack)', () => {
  const base = oracle.base as unknown as Omit<OracleFixture, 'schema' | 'spec'>;
  it('base spec: every oracle seed gives the pack spin', () => {
    const r = checkParity({ ...base, schema: 'slot_oracle_v1', spec } as OracleFixture);
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('feature spec: every oracle seed gives the pack spin', () => {
    const f = Object.values(oracle.features)[0] as unknown as Omit<OracleFixture, 'schema' | 'spec'>;
    const r = checkParity({ ...f, schema: 'slot_oracle_v1', spec: featureSpec } as OracleFixture);
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('the pack accepted both specs and the context is payline|global_mixture', () => {
    expect(oracle.base.context).toBe('payline|global_mixture');
    expect(oracle.base.families).toEqual(expect.arrayContaining(['expanding_wild', 'sticky_respin']));
  });
});

/** An empirical (coins, K) distribution of n engine spins. */
function sample(sp: SlotSpec, n: number, seed: number) {
  const rng = new Mulberry32(seed);
  const eng = slot.engine;
  const fe = slot.featureEngine!;
  const e = sp === spec ? eng : fe;
  const samples: { coins: number; k: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = e.spin(rng.u32());
    samples.push({ coins: r.totalCoins, k: triggerScatters(e, r) });
  }
  return empiricalDist(samples, 'test');
}

describe('exact RTP and the pack', () => {
  it('the TypeScript Monte Carlo RTP of the base spec is inside 4 SE of the pack mc replay', () => {
    // The pack's own figure is a 20,000-spin estimate (tier mc); ours replays the same draw to 1e-12 in slots:eval.
    const d = sample(spec, 60_000, 11);
    const r = distRtpReport(d, B);
    const pack = oracle.base.analytics as { rtp: number; se?: number; tier: string };
    expect(pack.tier).toBe('mc');
    const se = Math.sqrt((r.se ?? 0) ** 2 + (pack.se ?? 0.03) ** 2);
    expect(Math.abs(r.rtp - pack.rtp)).toBeLessThan(4 * se);
  });
  it('the shipped facts carry an mc RTP in 95.5-96.5% with its SE', () => {
    const f = facts as unknown as { rtp: number; rtpTier: string; rtpSe: number; rtpN: number };
    expect(f.rtpTier).toBe('mc');
    expect(f.rtp).toBeGreaterThan(0.955);
    expect(f.rtp).toBeLessThan(0.965);
    expect(f.rtpSe).toBeGreaterThan(0);
  });
});

describe('the winding', () => {
  it('every paying base spin is one payment on the final board, and only the final step pays', () => {
    let wins = 0;
    for (let s = 0; s < 4000; s++) {
      const r = canonicalSpin(spec, s);
      const last = r.steps[r.steps.length - 1];
      expect(r.steps.slice(0, -1).every((st) => st.stepCoins === 0)).toBe(true);
      expect(r.totalCoins).toBe(last.stepCoins + r.extras.reduce((a, e) => a + e.coins, 0));
      if (r.totalCoins > 0) wins++;
    }
    expect(wins).toBeGreaterThan(800);
  });
  it('every cell of the paying lines is a locked gear on the final board', () => {
    let checked = 0;
    for (let s = 0; s < 800; s++) {
      const r = canonicalSpin(spec, s);
      const last = r.steps[r.steps.length - 1];
      if (!last.wins.length) continue;
      const locked = new Set(((r.decor['sticky_respin.locked'] ?? []) as [number, number][]).map(([c, row]) => `${c},${row}`));
      for (const w of last.wins) for (const [c, row] of w.cells) expect(locked.has(`${c},${row}`)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('feature algebra vs Monte Carlo', () => {
  it('Grand Complication: E[spins] and E[feature win | trigger] match playRound within 4 SE', () => {
    const fdist = sample(featureSpec, 250_000, 5);
    const bdist = sample(spec, 250_000, 6);
    const br = distRtpReport(bdist, B);
    const a = freeSpinsAnalytics({
      baseRtp: br.rtp,
      baseTier: 'mc',
      baseRtpSe: br.se,
      betCoins: B,
      scatterDist: distScatter(bdist),
      scatterMin: 3,
      featureDist: fdist,
      cfg: config.feature!,
    });
    // Monte Carlo: rounds whose base spin triggers, K distributed as in play (conditioned on a trigger).
    const seedRng = new Mulberry32(77);
    const host = new Mulberry32(78);
    const totals: number[] = [];
    const spins: number[] = [];
    let tried = 0;
    while (totals.length < 2500 && tried < 2_000_000) {
      tried++;
      const seed = seedRng.u32();
      const probe = slot.engine.spin(seed);
      if (!probe.trigger?.fired) continue;
      const rd = slot.playRound(seed, () => host.u32());
      const f = rd.feature!;
      totals.push(f.totalCoins);
      spins.push(f.spins.length);
    }
    expect(totals.length).toBe(2500);
    const mean = (x: number[]) => x.reduce((p, c) => p + c, 0) / x.length;
    const sd = (x: number[]) => {
      const m = mean(x);
      return Math.sqrt(x.reduce((p, c) => p + (c - m) ** 2, 0) / (x.length - 1));
    };
    const seSpins = sd(spins) / Math.sqrt(spins.length);
    expect(Math.abs(mean(spins) - a.expectedSpinsGivenTrigger)).toBeLessThan(4 * seSpins + 0.05);
    // the algebra's own SE: the feature spin's SD over its n, times the expected spins
    let m1 = 0;
    let m2 = 0;
    fdist.p.forEach((p, i) => {
      m1 += p * fdist.coins[i];
      m2 += p * fdist.coins[i] ** 2;
    });
    const seAlg = (Math.sqrt(m2 - m1 * m1) / Math.sqrt(fdist.n!)) * a.expectedSpinsGivenTrigger;
    const seMc = sd(totals) / Math.sqrt(totals.length);
    expect(Math.abs(mean(totals) - a.expectedWinGivenTriggerCoins)).toBeLessThan(4 * Math.sqrt(seAlg ** 2 + seMc ** 2));
    expect(spinScatterCount(spec, canonicalSpin(spec, 1), {})).toBeGreaterThanOrEqual(0);
  }, 240_000);
});

describe('the max-win cap', () => {
  it('no round pays more than the declared cap', () => {
    const host = new Mulberry32(5);
    const seedRng = new Mulberry32(6);
    for (let i = 0; i < 20_000; i++) {
      const r = slot.playRound(seedRng.u32(), () => host.u32());
      expect(r.totalCoins).toBeLessThanOrEqual(config.maxWinStakes * B);
    }
  });
  it('a round that reaches a cap ends there and pays exactly the cap', () => {
    const tiny = createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: config.feature!, maxWinStakes: 0.5 });
    const host = new Mulberry32(9);
    let capped = 0;
    for (let s = 1; s < 300 && capped < 3; s++) {
      const r = tiny.playRound(s, () => host.u32());
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(Math.floor(0.5 * B));
      }
    }
    expect(capped).toBeGreaterThan(0);
  });
});

describe('the spin flow draws after place()', () => {
  const src = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
  it('SlotGame awaits ticket.place before it takes a seed or plays the round, and guards double presses', () => {
    const play = src.slice(src.indexOf('async function play('));
    const place = play.indexOf('await ticket.place(');
    const seed = play.indexOf('seeds.next()');
    const round = play.indexOf('engine.playRound(');
    expect(place).toBeGreaterThan(0);
    expect(seed).toBeGreaterThan(place);
    expect(round).toBeGreaterThan(seed);
    expect(play.indexOf('busyRef.current')).toBeLessThan(place);
    expect(play).toMatch(/if \(busyRef\.current\) return null/);
  });
  it('this game hands SlotGame the engine from createSlot (no engine override, no own draws)', () => {
    const game = readFileSync(join(here, 'Game.tsx'), 'utf8');
    expect(game).not.toMatch(/engine=/);
    expect(game).not.toMatch(/Math\.random/);
  });
});
