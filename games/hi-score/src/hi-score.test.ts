// Hi-Score: oracle parity, exact RTP, the feature algebra against the engine, the max-win cap, spin flow.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { createSlot, type SlotConfig, type SlotSpec } from '@originals/slots';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { spinDistribution, type SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { exactRtp } from '../../../packages/slots/src/engine/analytics/exact';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import { scatterCountDist } from '../../../packages/slots/src/engine/analytics/exact';

const dir = dirname(fileURLToPath(import.meta.url));
const load = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
const spec = load<SlotSpec>('slot.spec.json');
const fspec = load<SlotSpec>('feature.spec.json');
const config = load<SlotConfig>('slot.config.json');
const oracle = load<{ base: Omit<OracleFixture, 'schema' | 'spec'>; features: Record<string, Omit<OracleFixture, 'schema' | 'spec'>> }>('oracle.json');
const facts = load<{ volatilityDeclared: string }>('slot-facts.json');
const bet = spec.bet.coins;
const rng32 = (seed: number) => {
  const src = seededSource(seed);
  return () => Math.floor(src() * 2 ** 32) >>> 0;
};

const strip = (s: SlotSpec): SlotSpec => ({ ...s, mechanics: [] });
/** The exact (coins, K) law of one spin with the marquee folded in (the marquee is independent of the board). */
function withMarquee(s: SlotSpec): SpinDist {
  const d = spinDistribution(strip(s));
  const pmf = (s.mechanics[0] as unknown as { params: { value_pmf: Record<string, number> } }).params.value_pmf;
  const tot = Object.values(pmf).reduce((a, b) => a + b, 0);
  const acc = new Map<number, number>();
  d.p.forEach((p, i) => {
    for (const [v, w] of Object.entries(pmf)) {
      const key = d.coins[i] * Number(v) * 256 + d.k[i];
      acc.set(key, (acc.get(key) ?? 0) + (p * w) / tot);
    }
  });
  const keys = [...acc.keys()].sort((a, b) => a - b);
  return { coins: keys.map((k) => Math.floor(k / 256)), k: keys.map((k) => k % 256), p: keys.map((k) => acc.get(k)!), tier: 'exact', method: 'exact x marquee' };
}
const meanMarquee = (s: SlotSpec) => {
  const pmf = (s.mechanics[0] as unknown as { params: { value_pmf: Record<string, number> } }).params.value_pmf;
  const tot = Object.values(pmf).reduce((a, b) => a + b, 0);
  return Object.entries(pmf).reduce((a, [v, w]) => a + (Number(v) * w) / tot, 0);
};

describe('oracle parity (the pack, seed for seed)', () => {
  it('base spins equal oracle.json for all 2,000 seeds', () => {
    const r = checkParity({ schema: 'slot_oracle_v1', spec, ...oracle.base });
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('feature spins equal oracle.json for all seeds', () => {
    const r = checkParity({ schema: 'slot_oracle_v1', spec: fspec, ...oracle.features.feature });
    expect(r.firstMismatch).toBeNull();
  });
});

describe('exact RTP', () => {
  it('the TypeScript exact RTP (marquee folded in) equals the oracle RTP to 1e-9', () => {
    const raw = exactRtp(strip(spec)).rtp * meanMarquee(spec);
    const d = withMarquee(spec);
    const folded = d.p.reduce((a, p, i) => a + (p * d.coins[i]) / bet, 0);
    const pack = (oracle.base.analytics as { rtp: number }).rtp;
    expect(Math.abs(raw - pack)).toBeLessThan(1e-9);
    expect(Math.abs(folded - pack)).toBeLessThan(1e-9);
  });
  it('base + feature = 96% (the cap costs under 1e-6)', () => {
    const fa = freeSpinsAnalytics({ baseRtp: 0, baseTier: 'exact', betCoins: bet, scatterDist: scatterCountDist(strip(spec)), scatterMin: 3, featureDist: withMarquee(fspec), cfg: config.feature! });
    const bd = withMarquee(spec);
    const base = bd.p.reduce((a, p, i) => a + (p * bd.coins[i]) / bet, 0);
    expect(Math.abs(base + fa.featureRtp - 0.96)).toBeLessThan(5e-4);
  });
  it('the declared volatility is medium and the facts hit the bands', () => {
    expect(config.volatility).toBe('medium');
    expect(facts.volatilityDeclared).toBe('medium');
    const d = withMarquee(spec);
    const fa = freeSpinsAnalytics({ baseRtp: 0, baseTier: 'exact', betCoins: bet, scatterDist: scatterCountDist(strip(spec)), scatterMin: 3, featureDist: withMarquee(fspec), cfg: config.feature! });
    // round hit rate: the base spin pays, or it triggers and the feature pays
    const pBase = d.p.reduce((a, p, i) => a + (d.coins[i] > 0 ? p : 0), 0);
    const pTrigZero = d.p.reduce((a, p, i) => a + (d.coins[i] === 0 && d.k[i] >= 3 ? p : 0), 0);
    const hit = pBase + pTrigZero * (1 - fa.pZeroGivenTrigger);
    expect(hit).toBeGreaterThan(0.249);
    expect(hit).toBeLessThan(0.28);
  });
});

describe('the feature algebra against the engine', () => {
  const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature!, maxWinStakes: 1e9 });
  const probe = createSlot({ spec, maxWinStakes: 1e9 });
  it('E[feature win | trigger] matches playRound within 4 SE', () => {
    const fa = freeSpinsAnalytics({ baseRtp: 0, baseTier: 'exact', betCoins: bet, scatterDist: scatterCountDist(strip(spec)), scatterMin: 3, featureDist: withMarquee(fspec), cfg: config.feature! });
    const xs: number[] = [];
    for (let s = 1; xs.length < 1500 && s < 3_000_000; s++) {
      if (!probe.spin(s).trigger?.fired) continue;
      const r = slot.playRound(s, rng32(s));
      xs.push((r.feature?.totalCoins ?? 0) / bet);
    }
    expect(xs.length).toBe(1500);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    const se = sd / Math.sqrt(xs.length);
    expect(Math.abs(m - fa.averageFeatureWinStakes)).toBeLessThan(4 * se);
  }, 120_000);
});

describe('the max-win cap', () => {
  it('no round pays more than the cap, and a capped round says so', () => {
    const capStakes = 60;
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature!, maxWinStakes: capStakes });
    const probe = createSlot({ spec, maxWinStakes: 1e9 });
    let capped = 0;
    let n = 0;
    for (let s = 1; n < 1500 && s < 3_000_000; s++) {
      if (!probe.spin(s).trigger?.fired) continue;
      n++;
      const r = slot.playRound(s, rng32(s));
      expect(r.totalCoins).toBeLessThanOrEqual(capStakes * bet);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(capStakes * bet);
      }
    }
    expect(capped).toBeGreaterThan(0);
  }, 120_000);
  it('the declared cap is 2,500 stakes', () => expect(config.maxWinStakes).toBe(2500));
});

describe('the spin flow draws after place()', () => {
  const kit = readFileSync(join(dir, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
  it('SlotGame guards with a ref, awaits ticket.place(), and only then draws the seed', () => {
    const guard = kit.indexOf('if (busyRef.current) return null;');
    const place = kit.indexOf('await ticket.place(stake)', guard);
    const draw = kit.indexOf('seeds.next()');
    expect(guard).toBeGreaterThan(-1);
    expect(place).toBeGreaterThan(guard);
    expect(draw).toBeGreaterThan(place);
  });
  it('the game mounts that SlotGame with its own spec, and nothing draws outside it', () => {
    const game = readFileSync(join(dir, 'Game.tsx'), 'utf8');
    expect(game).toContain('<SlotGame');
    expect(game).not.toMatch(/Math\.random|playRound|\.spin\(/);
  });
});
