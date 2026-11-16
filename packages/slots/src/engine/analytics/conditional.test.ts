import { describe, expect, it } from 'vitest';
import { Mulberry32, SlotEngine, triggerScatters } from '../index';
import type { SlotSpec, SpinResult } from '../types';
import type { ModifierFeatureConfig, SlotConfig } from './config';
import {
  buildSplit,
  conditionalChunk,
  ForcedStopsRng,
  mechanicValueLaw,
  tailChunk,
  mergeCond,
  sampleTriggerBoard,
  splitRefusal,
  triggerCount,
  triggerLaw,
  validateSplit,
  type RawSpinLike,
} from './conditional';
import { distProb, exactSpinDistribution } from './distribution';
import { exactRtp } from './exact';
import { spinScatterCount } from './mc';
import { computeSlotStats } from './stats';
import noodleFeature from '../../../../../games/noodle-cart/src/feature.spec.json';
// Honeycomb's round-1 spec (ways + hold-and-respin only), frozen here so the game can change without moving these tests.
import honeycomb from './fixtures/honeycomb-r1.spec.json';

// An expanding wild on every reel, alone: it runs exactly when a wild is visible (trigger: ≥ 1 wild),
// and the spec WITH it has a closed form, so the split can be checked against the exact answer.
const EXPAND: SlotSpec = (() => {
  const s = structuredClone(noodleFeature) as unknown as SlotSpec;
  const mechs = s.mechanics as unknown as { id: string; params: Record<string, unknown> }[];
  const ew = mechs.find((m) => m.id === 'expanding_wild')!;
  ew.params = { ...ew.params, expand_reels: [0, 1, 2, 3, 4] };
  (s as { mechanics: unknown }).mechanics = [ew];
  delete (s as { trigger?: unknown }).trigger;
  return s;
})();
const WILD = EXPAND.symbols.filter((x) => x.role === 'wild').map((x) => x.id);
const MF: ModifierFeatureConfig = { name: 'Spread', mechanic: 'expanding_wild', trigger: { symbols: WILD, minCount: 1 } };
const HC = honeycomb as unknown as SlotSpec;
const HC_MF: ModifierFeatureConfig = { name: 'Honey Harvest', mechanic: 'hold_and_spin_lock_respin', trigger: { symbols: [11], minCount: 6 } };

const kOf = (spec: SlotSpec, eng: SlotEngine) => (r: RawSpinLike) => spinScatterCount(spec, r as unknown as SpinResult, { scatters: (x) => triggerScatters(eng, x) });

describe('the trigger law and the conditional sampler', () => {
  it('P(T) equals brute force over every stop combination of a small 3-reel set', () => {
    const spec = structuredClone(EXPAND);
    const strips = [
      [1, 2, 3, 2, 4],
      [2, 2, 3, 1, 4, 1],
      [3, 4, 1, 1],
    ];
    (spec as { geometry: unknown }).geometry = { cols: 3, rows: [2, 2, 2] };
    spec.board_law = { kind: 'strips_uniform', reel_sets: [{ id: 'a', weight: 1, strips }] } as SlotSpec['board_law'];
    const law = triggerLaw(spec, { symbols: [1], minCount: 3 });
    let hits = 0;
    let tot = 0;
    const freq = new Map<string, number>();
    for (let a = 0; a < 5; a++)
      for (let b = 0; b < 6; b++)
        for (let c = 0; c < 4; c++) {
          tot++;
          const board = [a, b, c].map((s, i) => [strips[i][s % strips[i].length], strips[i][(s + 1) % strips[i].length]]);
          if (triggerCount(board, [1]) >= 3) {
            hits++;
            freq.set(`${a},${b},${c}`, 0);
          }
        }
    expect(law.pT).toBeCloseTo(hits / tot, 14);
    // the sampler only draws triggering stops, each about equally often (uniform given T)
    const g = new Mulberry32(9);
    const u = () => g.u32() / 4294967296;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const { stops } = sampleTriggerBoard(law, u);
      const key = stops.join(',');
      expect(freq.has(key)).toBe(true);
      freq.set(key, freq.get(key)! + 1);
    }
    const expect1 = N / hits;
    for (const c of freq.values()) expect(Math.abs(c - expect1)).toBeLessThan(5 * Math.sqrt(expect1));
  });

  it('honeycomb: P(T) = 1 in 118.15, the conditional draws all trigger, the engine plays the forced stops', () => {
    const split = buildSplit(HC, HC_MF);
    expect(1 / split.law.pT).toBeCloseTo(118.1476, 3);
    const eng = new SlotEngine(HC);
    const res = conditionalChunk(eng, split, HC_MF, kOf(HC, eng), 2000, 5);
    expect(res.n).toBe(2000);
    expect(res.undetected).toBe(0);
    expect(res.count.reduce((a, b) => a + b, 0)).toBe(2000);
    // reproducible per seed, and merging is order-independent
    const again = conditionalChunk(eng, split, HC_MF, kOf(HC, eng), 2000, 5);
    expect(mergeCond([again])).toEqual(mergeCond([res]));
    const other = conditionalChunk(eng, split, HC_MF, kOf(HC, eng), 500, 6);
    expect(mergeCond([res, other])).toEqual(mergeCond([other, res]));
  });

  it('ForcedStopsRng refuses a draw out of the engine order', () => {
    const r = new ForcedStopsRng(0, [3, 4], 1, [10, 10], new Mulberry32(1));
    expect(() => r.u32()).toThrow(/raw u32/);
    expect(() => r.randrange(9)).toThrow(/strip has 10/);
    expect(r.randrange(10)).toBe(3);
    expect(r.randrange(10)).toBe(4);
    expect(r.done).toBe(true);
    expect(r.randrange(7)).toBeLessThan(7);
  });
});

describe('the trigger-conditional split', () => {
  it('refuses specs it cannot sample or price, by name', () => {
    expect(splitRefusal(HC, { ...HC_MF, mechanic: 'walking_wild' })).toMatch(/not in the spec's mechanics/);
    const hl = structuredClone(HC) as SlotSpec & { height_law?: unknown };
    hl.height_law = { kind: 'independent_categorical', reels: [] };
    expect(splitRefusal(hl, HC_MF)).toMatch(/fixed reel heights/);
    expect(splitRefusal(HC, HC_MF)).toBeNull();
  });

  it('the validity check passes on honeycomb and fails on a wrong trigger', () => {
    const eng = new SlotEngine(HC);
    const split = buildSplit(HC, HC_MF);
    const ok = validateSplit(eng, split, HC_MF, kOf(HC, eng), 5000, 3);
    expect(ok.ok).toBe(true);
    expect(ok.triggered).toBeGreaterThan(10);
    const wrong = { ...HC_MF, trigger: { symbols: [11], minCount: 7 } };
    const bad = validateSplit(eng, buildSplit(HC, wrong), wrong, kOf(HC, eng), 20000, 3);
    expect(bad.ok).toBe(false);
    expect(bad.violations[0]).toMatch(/trigger not shown on the initial board but the feature ran/);
  });

  it('an expanding wild: split RTP, hit rate and SD within 4 SE of the exact values', () => {
    expect(exactRtp(EXPAND).tier).toBe('exact');
    const eng = new SlotEngine(EXPAND);
    const split = buildSplit(EXPAND, MF);
    expect(validateSplit(eng, split, MF, kOf(EXPAND, eng), 5000, 11).ok).toBe(true);
    const cond = mergeCond([0, 1, 2, 3].map((i) => conditionalChunk(eng, split, MF, kOf(EXPAND, eng), 6000, 100 + i)));
    const config: SlotConfig = { maxWinStakes: 1_000_000, volatility: 'medium', targetRtp: 0.96, modifierFeature: MF };
    const st = computeSlotStats({
      spec: EXPAND,
      config,
      split: { exactDist: exactSpinDistribution(split.spec0), pT: split.law.pT, cond, method: 'test' },
      modifier: { name: MF.name, mechanic: MF.mechanic },
      mc: { rounds: 1000, sessions: 200, seed: 1 },
    });
    const exact = exactSpinDistribution(EXPAND);
    const bet = EXPAND.bet.coins;
    const ex = exactRtp(EXPAND).rtp;
    expect(st.rtpTier).toBe('mc');
    expect(Math.abs(st.rtpUncapped - ex) / st.rtpUncappedSe!).toBeLessThan(4);
    const hit = distProb(exact, (c) => c > 0);
    const hr = st.rows.find((r) => r.key === 'hitRate')!;
    expect(Math.abs(st.hitRate - hit) / hr.se!).toBeLessThan(4);
    let m1 = 0;
    let m2 = 0;
    exact.p.forEach((p, i) => {
      m1 += p * exact.coins[i];
      m2 += p * exact.coins[i] ** 2;
    });
    const sd = Math.sqrt(m2 - m1 * m1) / bet;
    const sdRow = st.rows.find((r) => r.key === 'volatility')!;
    expect(Math.abs(st.sdStakes - sd) / sdRow.se!).toBeLessThan(4);
    // the modifier rows: exact frequency, share = its RTP part / RTP
    const m = st.modifier!;
    expect(m.method).toBe('conditional');
    expect(m.frequency).toBeCloseTo(1 / split.law.pT, 9);
    expect(m.share).toBeCloseTo(m.rtpContribution / st.rtpUncapped, 12);
    expect(Math.abs(m.rtpContribution - (ex - exactRtp(split.spec0).rtp)) / m.rtpContributionSe!).toBeLessThan(4);
    expect(st.rows.find((r) => r.key === 'featureFrequency')!.label).toMatch(/Spread/);
  });
});

describe('the importance-sampled max-win tail', () => {
  it('is unbiased: tilted and plain estimates of P(X ≥ 150× | T) agree within 4 SE, the tilted one tighter', () => {
    const split = buildSplit(HC, HC_MF);
    const law = mechanicValueLaw(HC, HC_MF.mechanic)!;
    expect(law.values).toHaveLength(8);
    const eng = new SlotEngine(HC);
    const cap = 150 * HC.bet.coins;
    const est = (eps: number) => {
      const t = tailChunk(eng, split, law, cap, 15_000, 77, eps);
      const m = t.sumW / t.n;
      return { m, se: Math.sqrt(Math.max(0, t.sumW2 / t.n - m * m) / t.n), meanW: t.sumAll / t.n, hits: t.hits };
    };
    const plain = est(0);
    const tilted = est(0.1);
    expect(plain.meanW).toBe(1);
    expect(Math.abs(tilted.meanW - 1)).toBeLessThan(0.05);
    expect(tilted.hits).toBeGreaterThan(plain.hits);
    expect(Math.abs(tilted.m - plain.m) / Math.hypot(tilted.se, plain.se)).toBeLessThan(4);
    expect(tilted.se).toBeLessThan(plain.se);
  });
});
