// Caldera's maths checks: parity with the engine pack (oracle.json), the RTP the pack measured, the free-spins
// algebra against the engine, the max-win cap, and the order of the spin flow (draw only after place()).
// This is a cluster game with a cascade ladder, so its RTP has no closed form: the "exact" check is the port
// replaying the pack's own Monte Carlo draw (same seeds, same spins) and matching the pack's RTP to 1e-12.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SlotEngine, createSlot, triggerScatters, type SlotSpec } from '@originals/slots';
import { checkCopy } from '@originals/slots/ui';
import { LAVA, copy } from './copy';
import { award, multiplierAt, type SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { featureValue } from '../../../packages/slots/src/engine/analytics/features';
import { mcSpinDistribution, spinSeeds } from '../../../packages/slots/src/engine/analytics/mc';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { Mulberry32 } from '../../../packages/slots/src/engine/rng';
import oracle from './oracle.json';
import featureSpecJson from './feature.spec.json';
import configJson from './slot.config.json';
import specJson from './slot.spec.json';

const dir = dirname(fileURLToPath(import.meta.url));
const spec = specJson as unknown as SlotSpec;
const featureSpec = featureSpecJson as unknown as SlotSpec;
const config = configJson as unknown as SlotConfig;
const feat = config.feature!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ora = oracle as any;

const fixture = (entry: typeof ora.base, s: SlotSpec): OracleFixture => ({ ...entry, schema: 'slot_oracle_v1', spec: s });

describe('oracle parity (the TypeScript engine is the pack, spin for spin)', () => {
  it('base: all 2,000 seeds identical', () => {
    const r = checkParity(fixture(ora.base, spec));
    expect(r.firstMismatch).toBeNull();
    expect(r.seeds).toBe(2000);
  });
  it('feature: all 2,000 seeds identical', () => {
    const r = checkParity(fixture(ora.features.feature, featureSpec));
    expect(r.firstMismatch).toBeNull();
  });
  it('oracle.json is for this spec (the pack accepted a cluster + cascade_step_ladder + power_wild_level build)', () => {
    expect(ora.base.context).toBe('cluster|global_mixture');
    expect(ora.base.families).toEqual(['cascade_step_ladder', 'power_wild_level']);
    expect(ora.base.analytics.tier ?? 'mc').toBe('mc');
  });
});

describe('RTP equals the pack', () => {
  for (const [name, entry, s] of [
    ['base', ora.base, spec],
    ['feature', ora.features.feature, featureSpec],
  ] as const) {
    it(`${name}: replaying the pack's one-stream Monte Carlo gives the pack's RTP to 1e-12`, () => {
      // the pack's mc_stream: ONE Mulberry32(content seed) stream runs through n_mc consecutive spins
      const eng = new SlotEngine(s);
      const a = entry.analytics;
      const rng = new Mulberry32(a.instrument.seed);
      let sum = 0;
      for (let i = 0; i < a.n_mc; i++) sum += eng.spinRaw(rng).totalCoins;
      expect(Math.abs(sum / a.n_mc / s.bet.coins - a.rtp)).toBeLessThan(1e-12);
    }, 60_000);
  }
});

describe('the free-spins algebra against the engine', () => {
  it('E[feature win | 3 scatters] from the algebra is within 4 SE of playing the feature spin by spin', () => {
    const eng = new SlotEngine(featureSpec);
    const n0 = award(feat.awards, 3);
    // the algebra, from a Monte Carlo of the feature spin's own (coins, K) distribution
    const dist = mcSpinDistribution(featureSpec, (_s, seed) => eng.spin(seed), 300_000, 11, { scatters: (r) => triggerScatters(eng, r) });
    const algebra = featureValue(dist, feat, n0);
    // the engine: the same law (awards, retrigger, multiplier) played out, as createSlot.playRound does
    const rng = new Mulberry32(99);
    const plays = 20_000;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < plays; i++) {
      let left = n0;
      let granted = n0;
      let played = 0;
      let retriggers = 0;
      let total = 0;
      while (left > 0) {
        const res = eng.spin(rng.u32());
        total += res.totalCoins * multiplierAt(feat.multiplier, played + 1, retriggers);
        const a = award(feat.retrigger, triggerScatters(eng, res));
        const extra = Math.max(0, Math.min(a, feat.maxSpins - granted));
        granted += extra;
        if (a > 0) retriggers += 1;
        left += extra - 1;
        played += 1;
      }
      sum += total;
      sum2 += total * total;
    }
    const mean = sum / plays;
    const se = Math.sqrt((sum2 / plays - mean * mean) / plays);
    // the algebra's own error: its spin distribution is sampled too (spins per feature × per-spin SE)
    const spinSd = Math.sqrt(dist.p.reduce((s, p, i) => s + p * dist.coins[i] ** 2, 0) - dist.p.reduce((s, p, i) => s + p * dist.coins[i], 0) ** 2);
    const seAlg = (spinSd / Math.sqrt(300_000)) * algebra.expectedSpins;
    expect(Math.abs(mean - algebra.expectedWinCoins)).toBeLessThan(4 * Math.sqrt(se * se + seAlg * seAlg));
  }, 240_000);
});

describe('the max-win cap', () => {
  it('config caps a round at 10,000 stakes, above every paytable row', () => {
    expect(config.maxWinStakes).toBe(10000);
    expect(createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: feat, maxWinStakes: config.maxWinStakes }).maxWinCoins).toBe(10000 * 100);
    // no pay figure the paytable shows is beyond the max win
    for (const s of [spec, featureSpec]) for (const t of Object.values(s.pays.paytable)) for (const v of Object.values(t)) expect(v).toBeLessThanOrEqual(10000 * 100);
  });
  it('no round pays more than the cap, and a round that reaches it says so', () => {
    const cap = 12; // a tiny cap so that capped rounds are common
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: feat, maxWinStakes: cap });
    const rng = new Mulberry32(5);
    let capped = 0;
    let withFeature = 0;
    for (const seed of spinSeeds(6000, 3)) {
      const r = slot.playRound(seed, () => rng.u32());
      expect(r.totalCoins).toBeLessThanOrEqual(cap * 100);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(cap * 100);
      }
      if (r.feature) withFeature++;
    }
    expect(capped).toBeGreaterThan(0);
    expect(withFeature).toBeGreaterThan(0);
  }, 120_000);
});

// The signature rule: lava cools. Every lava wild lands at one level (2 in the base game, 3 in Eruption spins);
// a lava wild in a win above level 1 stays on the board (falling with the survivors) and drops a level.
// Replayed here from the boards and wins alone, so the copy's "stays for 2 wins, 3 in Eruption" is the maths.
function lavaLevel(s: SlotSpec): number {
  const m = s.mechanics.find((x) => x.id === 'power_wild_level');
  const pmf = (m?.params as { level_pmf: Record<string, number> }).level_pmf;
  expect(Object.keys(pmf)).toHaveLength(1);
  return Number(Object.keys(pmf)[0]);
}

function checkLavaCools(s: SlotSpec, level: number, seeds: number): { stayed: number; cooled: number } {
  const eng = new SlotEngine(s);
  let stayed = 0;
  let cooled = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const res = eng.spin(seed);
    // levels of the lava on the board now, by cell
    let lv = new Map<string, number>();
    res.steps[0].board.forEach((col, c) => col.forEach((v, r) => v === LAVA && lv.set(`${c},${r}`, level)));
    for (let i = 0; i + 1 < res.steps.length; i++) {
      const { board, wins } = res.steps[i];
      if (!wins.length) break;
      const removed = new Set<string>();
      for (const w of wins) for (const [c, r] of w.cells) removed.add(`${c},${r}`);
      const kept = new Map<string, number>();
      for (const key of removed) {
        const l = lv.get(key);
        if (l === undefined) continue;
        if (l > 1) {
          kept.set(key, l - 1);
          removed.delete(key);
          stayed++;
        } else cooled++;
      }
      // gravity: the survivors of each column fall to its bottom, in order; the lava among them keeps its level
      const next = res.steps[i + 1].board;
      const nlv = new Map<string, number>();
      board.forEach((col, c) => {
        const surv = col.map((v, r) => ({ v, key: `${c},${r}` })).filter((x) => !removed.has(x.key));
        const m = col.length - surv.length;
        surv.forEach((x, j) => {
          expect(next[c][m + j]).toBe(x.v);
          const l = kept.get(x.key) ?? lv.get(x.key);
          if (l !== undefined) nlv.set(`${c},${m + j}`, l);
        });
        for (let r = 0; r < m; r++) if (next[c][r] === LAVA) nlv.set(`${c},${r}`, level);
      });
      lv = nlv;
    }
  }
  return { stayed, cooled };
}

describe('lava cools: the signature rule', () => {
  it('lava lands at level 2 in the base game and 3 in Eruption spins, as the copy says', () => {
    expect(lavaLevel(spec)).toBe(2);
    expect(lavaLevel(featureSpec)).toBe(3);
    expect(copy.wildText).toMatch(/2 wins, 3 in Eruption/);
    expect(copy.featureRule).toMatch(/Lava stays 3 wins/);
  });
  it('base: a paying lava stays for one more win, then leaves (boards replayed)', () => {
    const { stayed, cooled } = checkLavaCools(spec, 2, 4000);
    expect(stayed).toBeGreaterThan(50);
    expect(cooled).toBeGreaterThan(5);
  }, 60_000);
  it('Eruption spins: a paying lava stays for two more wins', () => {
    const { stayed, cooled } = checkLavaCools(featureSpec, 3, 3000);
    expect(stayed).toBeGreaterThan(cooled);
    expect(cooled).toBeGreaterThan(5);
  }, 60_000);
});

describe('copy', () => {
  it('every line is under 9 words', () => {
    expect(checkCopy(copy)).toEqual([]);
  });
});

describe('the spin flow draws after place()', () => {
  const kit = readFileSync(join(dir, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
  const game = readFileSync(join(dir, 'Game.tsx'), 'utf8');
  it("the kit awaits ticket.place before it takes a seed or calls playRound, behind a busy guard", () => {
    const play = kit.slice(kit.indexOf('async function play('));
    const guard = play.indexOf('busyRef.current');
    const place = play.indexOf('await ticket.place(');
    const seed = play.indexOf('seeds.next()');
    const round = play.indexOf('engine.playRound(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(place);
    expect(place).toBeLessThan(seed);
    expect(seed).toBeLessThan(round);
  });
  it('the game hands the kit its spec and never spins or draws by itself', () => {
    expect(game).not.toMatch(/playRound|\.spin\(|Math\.random|engine=/);
    expect(game).toMatch(/<SlotGame/);
  });
});
