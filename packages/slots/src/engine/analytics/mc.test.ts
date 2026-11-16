import { describe, expect, it } from 'vitest';
import type { SlotSpec, SpinResult } from '../types';
import { exactRtp } from './exact';
import { distMean, distScatter } from './distribution';
import { distRtpReport, mcRtp, mcSpinDistribution, spinScatterCount, spinSeeds, type SpinFn } from './mc';
import { boardAt, boardCoins, buildModel } from './model';
import { mulberry32 } from './rng';
import pack from './fixtures/pack-analytics.json';

interface ExactCase {
  panel: string;
  rtp: number;
  trigger_p: number;
  spec: unknown;
}
interface McCase {
  panel: string;
  rtp: number;
  rtp_se: number;
  n_mc: number;
  trigger_p: number;
  spec: unknown;
}
const exactCases = (pack as unknown as { exact: ExactCase[] }).exact;
const mcCases = (pack as unknown as { mc: McCase[] }).mc;

/** A stand-in for canonicalSpin built from the analytic model: uniform stops from Mulberry32(seed). */
function stubSpin(): SpinFn {
  const cache = new Map<SlotSpec, ReturnType<typeof buildModel>>();
  return (spec, seed) => {
    let m = cache.get(spec);
    if (!m) cache.set(spec, (m = buildModel(spec)));
    const rng = mulberry32(seed);
    const u = rng();
    let ci = 0;
    let acc = 0;
    for (; ci < m.components.length - 1; ci++) if (u < (acc += m.components[ci].weight)) break;
    const comp = m.components[ci];
    const stops = comp.strips.map((s) => Math.floor(rng() * s.length));
    const board = boardAt(m, comp, stops);
    const { coins, k } = boardCoins(m, board);
    const sp = m.scatter !== null ? m.scatterPay[String(k)] ?? 0 : 0;
    const fired = m.triggerMin !== null && k >= m.triggerMin;
    const r: SpinResult = {
      decor: {},
      extras: sp ? [{ coins: sp, label: `SCATTER PAY (${k} scatters)` }] : [],
      finalBoard: board,
      flags: [],
      set: ci,
      steps: [{ board, stepCoins: coins - sp, wins: [] }],
      stops,
      totalCoins: coins,
      trigger: fired ? { fired: true, text: `${k} scatters -> feature trigger (out of scope)` } : null,
    };
    return r;
  };
}

describe('mc.ts with a model-built stub spin', () => {
  const c = exactCases.find((x) => x.panel === 'panel-plain-line-eval-no-modifier')!;
  const spec = c.spec as SlotSpec;

  it('seeds are deterministic u32s', () => {
    const a = spinSeeds(5, 42);
    expect(a).toEqual(spinSeeds(5, 42));
    for (const s of a) expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    expect(new Set(spinSeeds(1000, 1)).size).toBe(1000);
  });

  it('MC RTP agrees with exactRtp within 4 SE, and K is the scatter count', () => {
    const n = 60_000;
    const spin = stubSpin();
    const r = mcRtp(spec, spin, n, 7);
    const ex = exactRtp(spec).rtp;
    console.log(`  stub MC rtp ${r.rtp.toFixed(5)} ± ${r.se!.toFixed(5)} vs exact ${ex.toFixed(5)} (z ${((r.rtp - ex) / r.se!).toFixed(2)})`);
    expect(r.tier).toBe('mc');
    expect(r.n).toBe(n);
    expect(Math.abs(r.rtp - ex)).toBeLessThan(4 * r.se!);
    const d = mcSpinDistribution(spec, spin, n, 7);
    expect(distMean(d) / spec.bet.coins).toBeCloseTo(r.rtp, 12);
    // trigger frequency within 4 SE of the exact trigger_p
    const sc = distScatter(d);
    const tp = sc.reduce((a, p, k) => a + (k >= (spec.trigger?.scatter_min ?? Infinity) ? p : 0), 0);
    expect(Math.abs(tp - c.trigger_p)).toBeLessThan(4 * Math.sqrt((c.trigger_p * (1 - c.trigger_p)) / n));
  });

  it('K: trigger text, then the scatter-pay label, then the board', () => {
    const base = stubSpin()(spec, 3);
    const board = [[1, 1, 3], [1, 4, 5], [6, 7, 8], [9, 10, 3], [4, 5, 6]];
    const plain: SpinResult = { ...base, steps: [{ board, stepCoins: 0, wins: [] }], finalBoard: board, extras: [], trigger: null };
    expect(spinScatterCount(spec, plain)).toBe(3);
    expect(spinScatterCount(spec, { ...plain, trigger: { fired: true, text: '4 scatters -> feature trigger (out of scope)' } })).toBe(4);
    expect(spinScatterCount(spec, { ...plain, extras: [{ coins: 9, label: 'SCATTER PAY (2 scatters)' }] })).toBe(2);
    expect(spinScatterCount(spec, plain, { scatters: () => 7 })).toBe(7);
    // a tumbling spec counts on the final board
    const tumbling = { ...spec, mechanics: [{ id: 'tape_continuation_refill', params: {} }] } as SlotSpec;
    const moved: SpinResult = { ...plain, finalBoard: [[1, 3, 3], [4, 4, 5], [6, 7, 8], [9, 10, 3], [4, 5, 6]] };
    expect(spinScatterCount(tumbling, moved)).toBe(1);
    expect(spinScatterCount(spec, moved)).toBe(3);
  });
});

describe('mc.ts through the engine port (canonicalSpin) vs the pack on its mc examples', async () => {
  let eng: Record<string, unknown> | null = null;
  try {
    eng = (await import('../index')) as unknown as Record<string, unknown>;
  } catch {
    eng = null;
  }
  const canonicalSpin = eng?.canonicalSpin as SpinFn | undefined;
  const SlotEngine = eng?.SlotEngine as (new (s: SlotSpec) => unknown) | undefined;
  const triggerScatters = eng?.triggerScatters as ((e: unknown, r: SpinResult) => number) | undefined;
  for (const c of mcCases) {
    it.skipIf(typeof canonicalSpin !== 'function')(`${c.panel}: RTP within 4·√(se_ts² + se_pack²), trigger_p within 4 SE`, () => {
      const spec = c.spec as SlotSpec;
      const n = 10_000;
      const opts = SlotEngine && triggerScatters ? { scatters: ((e) => (r: SpinResult) => triggerScatters(e, r))(new SlotEngine(spec)) } : {};
      const d = mcSpinDistribution(spec, canonicalSpin!, n, 20261116, opts);
      const bet = spec.bet.coins;
      const mean = distMean(d);
      let m2 = 0;
      d.p.forEach((p, i) => (m2 += p * d.coins[i] ** 2));
      const se = Math.sqrt((m2 - mean * mean) / n) / bet;
      const rtp = mean / bet;
      const tol = 4 * Math.hypot(se, c.rtp_se);
      const sc = distScatter(d);
      const smin = spec.trigger?.scatter_min ?? Infinity;
      const tp = sc.reduce((a, p, k) => a + (k >= smin ? p : 0), 0);
      const tpSe = Math.hypot(Math.sqrt((tp * (1 - tp)) / n), Math.sqrt((c.trigger_p * (1 - c.trigger_p)) / c.n_mc));
      console.log(`  ${c.panel}: ts ${rtp.toFixed(4)} ± ${se.toFixed(4)} vs pack ${c.rtp.toFixed(4)} ± ${c.rtp_se.toFixed(4)}; trigger ${tp.toFixed(4)} vs ${c.trigger_p}`);
      expect(Math.abs(rtp - c.rtp)).toBeLessThan(tol);
      expect(Math.abs(tp - c.trigger_p)).toBeLessThan(4 * tpSe + 1e-12);
      const rep = distRtpReport(d, bet);
      expect(rep.rtp).toBeCloseTo(rtp, 12);
      expect(rep.se!).toBeCloseTo(se, 4);
    }, 60_000);
  }
  // The pack's mc_analytics runs Mulberry32(content_seed + i), i < n_mc. Its content seeds for these
  // three specs (base.analytics(...)['instrument']['seed'], pack v1.0.0) let the port replay it exactly.
  const CONTENT_SEED: Record<string, number> = {
    'panel-scatterpay-tumble-no-mult': 261654434,
    'panel-bg-payline-cascade-megaways-roundbank': 1138214937,
    'panel-bg-scatterpay-roundbank': 2210988205,
  };
  for (const c of mcCases) {
    it.skipIf(typeof canonicalSpin !== 'function' || !(c.panel in CONTENT_SEED))(`${c.panel}: replays the pack's own mc RTP exactly (consecutive seeds)`, () => {
      const r = mcRtp(c.spec as SlotSpec, canonicalSpin!, c.n_mc, CONTENT_SEED[c.panel], { consecutiveSeeds: true });
      expect(Math.abs(r.rtp - c.rtp)).toBeLessThan(1e-12);
    }, 60_000);
  }
});
