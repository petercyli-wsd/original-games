import { describe, expect, it } from 'vitest';
import { bandRows, factGateFailures, hitRateBand, normaliseFacts, wideMisses, type Declared } from './facts';

const declared: Declared = { volatility: 'high', feature: 'free_spins', maxWin: 5000, evaluation: 'payline', cols: 5, rows: 3 };

const good = {
  rtp: 0.9601,
  rtpTier: 'exact',
  hitRate: 0.28,
  winOverStakeRate: 0.14,
  volatilitySd: 13.2,
  featureOneIn: 160,
  featureShare: 0.38,
  avgFeatureWin: 58,
  bigWinOneIn: 900,
  maxWinStakes: 5000,
  pMaxWin: 2e-8,
  dryStreakP95: 12,
  sessionMedian: 71,
};

describe('normaliseFacts', () => {
  it('reads camelCase facts', () => {
    const { facts, missing } = normaliseFacts(good);
    expect(missing).toEqual([]);
    expect(facts.maxWinOneIn).toBeCloseTo(5e7);
    expect(facts.featureOneIn).toBe(160);
  });

  it('accepts percentages, snake_case, nested blocks and probabilities', () => {
    const { facts } = normaliseFacts({ rtp: { value: 96.02, tier: 'mc', se: 0.03 }, base: { hit_rate: 31 }, feature: { trigger_p: 0.005 }, dry_streak_p95: 9 });
    expect(facts.rtp).toBeCloseTo(0.9602);
    expect(facts.hitRate).toBeCloseTo(0.31);
    expect(facts.featureOneIn).toBeCloseTo(200);
    expect(facts.dryStreakP95).toBe(9);
    expect(facts.rtpTier).toBe('mc');
    expect(facts.rtpSe).toBeCloseTo(0.0003);
  });

  it('lists what it could not find', () => {
    expect(normaliseFacts({ rtp: 0.96 }).missing).toContain('dry streak p95');
  });
});

describe('bands', () => {
  it('picks the hit-rate band by mechanism and size', () => {
    expect(hitRateBand(declared).slice(0, 2)).toEqual([0.2, 0.45]);
    expect(hitRateBand({ ...declared, cols: 3, rows: 3 }).slice(0, 2)).toEqual([0.1, 0.25]);
    expect(hitRateBand({ ...declared, evaluation: 'cluster' }).slice(0, 2)).toEqual([0.25, 0.45]);
  });

  it('a healthy game is in every band and passes the gated facts', () => {
    const rows = bandRows(normaliseFacts(good).facts, declared);
    expect(rows.filter((r) => r.status === 'out' || r.status === 'wide')).toEqual([]);
    expect(factGateFailures(rows)).toEqual([]);
    expect(wideMisses(rows)).toEqual([]);
  });

  it('a miss within the width is "out" (gate only); beyond it is "wide" (caps maths fit)', () => {
    // Hit rate band 20–45%, width 25 points: 10% misses by 10 → out; general band, -6% impossible, so use the classic band.
    const out = bandRows(normaliseFacts({ ...good, hitRate: 0.1 }).facts, declared);
    expect(out.find((r) => r.key === 'hitRate')!.status).toBe('out');
    expect(factGateFailures(out)).toEqual([expect.stringMatching(/^Hit rate 10.0% outside/)]);
    expect(wideMisses(out)).toEqual([]);
    // RTP band 95.5–96.5, width 1 point: 94% misses by 1.5 → wide.
    const wide = bandRows(normaliseFacts({ ...good, rtp: 0.94 }).facts, declared);
    expect(wide.find((r) => r.key === 'rtp')!.status).toBe('wide');
    expect(wideMisses(wide)).toEqual([expect.stringMatching(/^RTP 94.00%/)]);
  });

  it('checks the SD against the declared volatility', () => {
    const rows = bandRows(normaliseFacts({ ...good, volatilitySd: 3 }).facts, declared);
    // High is 10–20, width 10: SD 3 misses by 7 → out, not wide.
    expect(rows.find((r) => r.key === 'sd')!.status).toBe('out');
    const low = bandRows(normaliseFacts({ ...good, volatilitySd: 14 }).facts, { ...declared, volatility: 'low' });
    // Low is 2–5, width 3: SD 14 misses by 9 → wide.
    expect(low.find((r) => r.key === 'sd')!.status).toBe('wide');
  });

  it('gates the dry streak and max-win reachability, and fails when they are not measured', () => {
    // The dry-streak limit follows the declared volatility: low 12, medium 20, high 26, extreme 32.
    expect(factGateFailures(bandRows(normaliseFacts({ ...good, dryStreakP95: 26 }).facts, declared))).toEqual([]);
    const dry = bandRows(normaliseFacts({ ...good, dryStreakP95: 27 }).facts, declared);
    expect(factGateFailures(dry)).toEqual([expect.stringMatching(/^Dry streak p95 .* 27 outside ≤ 26 \(high\)/)]);
    const low = bandRows(normaliseFacts({ ...good, dryStreakP95: 13 }).facts, { ...declared, volatility: 'low' });
    expect(factGateFailures(low)).toEqual([expect.stringMatching(/13 outside ≤ 12 \(low\)/)]);
    expect(factGateFailures(bandRows(normaliseFacts({ ...good, dryStreakP95: 32 }).facts, { ...declared, volatility: 'extreme' }))).toEqual([]);
    // Over twice the limit caps maths fit.
    expect(wideMisses(bandRows(normaliseFacts({ ...good, dryStreakP95: 25 }).facts, { ...declared, volatility: 'low' }))).toContainEqual(expect.stringMatching(/^Dry streak/));
    // No declared volatility: the dry streak can't be judged, and the gate says why.
    const undeclared = bandRows(normaliseFacts(good).facts, { ...declared, volatility: undefined });
    expect(factGateFailures(undeclared)).toEqual([expect.stringMatching(/no declared volatility/)]);
    const unreachable = bandRows(normaliseFacts({ ...good, pMaxWin: 1e-11 }).facts, declared);
    expect(factGateFailures(unreachable)).toEqual([expect.stringMatching(/^P\(max win\)/)]);
    const unmeasured = bandRows(normaliseFacts({ rtp: 0.96, hitRate: 0.3 }).facts, declared);
    expect(factGateFailures(unmeasured)).toHaveLength(2);
  });

  it('skips the feature bands for a pure base game', () => {
    const rows = bandRows(normaliseFacts(good).facts, { ...declared, feature: null });
    expect(rows.find((r) => r.key === 'featureOneIn')).toBeUndefined();
  });

  it('uses the smaller-feature frequency band for a non-free-spins feature', () => {
    const rows = bandRows(normaliseFacts({ ...good, featureOneIn: 60 }).facts, { ...declared, feature: 'hold_and_spin' });
    expect(rows.find((r) => r.key === 'featureOneIn')!.status).toBe('in');
  });
});

describe('slot_facts_v1 (scripts/slots/eval.ts)', () => {
  it('reads the fields slots:eval writes', () => {
    const { facts, missing } = normaliseFacts({
      schema: 'slot_facts_v1',
      rtp: 0.9603,
      rtpTier: 'exact',
      rtpSe: 0,
      hitRate: 0.342,
      volatility: 'high',
      volatilitySd: 14.1,
      maxWin: 5000,
      featureFreq: 171.4,
      featureShare: 0.39,
      volatilityDeclared: 'high',
      winOverStakeRate: 0.12,
      avgFeatureWin: 64.2,
      pWin100: 0.0009,
      pMaxWin: 3e-8,
      dryStreakP95: 15,
      sessionMedian: 78,
      feature: { kind: 'free_spins', triggerP: 0.005834, averageWinStakes: 64.2 },
      stats: [{ key: 'rtp', value: 0.9603 }],
    });
    expect(missing).toEqual([]);
    expect(facts).toMatchObject({ rtp: 0.9603, hitRate: 0.342, sd: 14.1, maxWin: 5000, featureShare: 0.39, avgFeatureWin: 64.2, dryStreakP95: 15, sessionMedian: 78 });
    expect(facts.featureOneIn).toBeCloseTo(171.4, 0);
    expect(facts.bigWinOneIn).toBeCloseTo(1111, 0);
    expect(facts.maxWinOneIn).toBeCloseTo(3.33e7, -5);
    expect(facts.rtpSe).toBe(0);
  });
});
