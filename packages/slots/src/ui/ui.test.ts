// Tests for the pure parts of the slot UI kit and the demo's stub engine.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { emberDemo, megaDemo, reefDemo } from './demo/demos';
import { createSeedSource, resolveEngine, seededRng32 } from './engine-bridge';
import { anticipationPlan, bigWinTier, decorOverlays, featureRules, fmtX, initialSpins, multiplierNote, parseSlotFacts, parseWinLabel, payRows, reelStopMs, reelTimings, rollMs } from './util';

describe('timing rules', () => {
  it('Manual: first reel stops at 0.9 s, the last by 1.6 s, for any reel count', () => {
    for (const cols of [3, 5, 6, 8]) {
      expect(reelStopMs(0, cols, false)).toBe(900);
      expect(reelStopMs(cols - 1, cols, false)).toBeLessThanOrEqual(1600);
      expect(reelStopMs(cols - 1, cols, false)).toBeGreaterThan(900);
    }
  });
  it('Turbo: everything stops in about 0.3 s, with no suspense', () => {
    for (const cols of [3, 5, 8]) expect(reelStopMs(cols - 1, cols, true)).toBeLessThanOrEqual(310);
    expect(reelTimings(5, true).suspense).toBe(0);
  });
  it('the win counter is proportional to the win and capped at 3 s', () => {
    expect(rollMs(1, false)).toBeLessThan(rollMs(10, false));
    expect(rollMs(10, false)).toBeLessThan(rollMs(40, false));
    expect(rollMs(1e6, false)).toBe(3000);
    expect(rollMs(1e6, true)).toBeLessThan(1000);
  });
  it('big-win tiers start at 20× and 100×', () => {
    expect([0, 19.99, 20, 99.99, 100, 5000].map(bigWinTier)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('anticipation is only real', () => {
  const SC = 1;
  const board = (cols: number[][]) => cols;
  it('slows the reels after two scatters when a third can still land', () => {
    const b = board([[SC, 5, 5], [5, 5, 5], [SC, 5, 5], [5, 5, 5], [5, 5, 5]]);
    expect(anticipationPlan(b, [SC], 3)).toEqual([false, false, false, true, true]);
  });
  it('does not slow when only one scatter has landed', () => {
    const b = board([[SC, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]]);
    expect(anticipationPlan(b, [SC], 3).some(Boolean)).toBe(false);
  });
  it('does not slow when no remaining reel can show a scatter', () => {
    const b = board([[SC, 5, 5], [SC, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]]);
    expect(anticipationPlan(b, [SC], 3, (c) => c < 2).some(Boolean)).toBe(false);
  });
  it('stops slowing once the trigger has landed', () => {
    const b = board([[SC, 5, 5], [SC, 5, 5], [SC, 5, 5], [5, 5, 5], [5, 5, 5]]);
    expect(anticipationPlan(b, [SC], 3)).toEqual([false, false, true, false, false]);
  });
  it('has nothing to anticipate without a scatter symbol', () => {
    expect(anticipationPlan([[5], [5]], [], 3)).toEqual([false, false]);
  });
});

describe('parsing', () => {
  it('reads decor money maps as cell badges', () => {
    const m = decorOverlays({ 'orb_sum_terminal.orbVals': { '0,1': 2, '3,2': 10 }, other: 5, cells: [[0, 0]] });
    expect([...m.entries()]).toEqual([['0,1', '×2'], ['3,2', '×10']]);
    expect(decorOverlays({ 'x.coinVals': { '1,1': 7 } }).get('1,1')).toBe('7');
    expect(decorOverlays({ k: { '0,0': 3 } }, { k: (v) => `+${v}` }).get('0,0')).toBe('+3');
  });
  it('splits win labels', () => {
    expect(parseWinLabel('P2 x3')).toEqual({ symbol: 'P2', count: 3 });
    expect(parseWinLabel('L1 x4 (1 ways)')).toEqual({ symbol: 'L1', count: 4 });
    expect(parseWinLabel('weird')).toBeNull();
  });
  it('reads facts in either spelling and refuses a made-up number', () => {
    const a = parseSlotFacts({ rtp: { value: 0.96, tier: 'mc', se: 0.0003, n: 1e8 }, hit_rate: 0.3, max_win: 5000, feature_p: 0.005, volatility: 'high' });
    expect(a).toMatchObject({ rtp: 0.96, rtpTier: 'mc', rtpSe: 0.0003, rtpN: 1e8, hitRate: 0.3, maxWinStakes: 5000, featureOneIn: 200, volatility: 'high' });
    expect(parseSlotFacts({ rtp: 0.96, rtpTier: 'exact', hitRate: 0.2, maxWinStakes: 1000, featureOneIn: 150 }).featureOneIn).toBe(150);
    expect(() => parseSlotFacts({ rtp: 0.96, rtpTier: 'exact' })).toThrow();
    expect(() => parseSlotFacts({ rtp: 0.96, hitRate: 0.2, maxWinStakes: 10 })).toThrow(/tier/);
  });
  it('merges equal consecutive pays into count ranges, highest first', () => {
    const rows = payRows({ '8': 50, '9': 50, '10': 125, '11': 125, '12': 300 }, 100);
    expect(rows.map((r) => [r.from, r.to, r.stakes])).toEqual([[12, 12, 3], [10, 11, 1.25], [8, 9, 0.5]]);
    expect(fmtX(0.15)).toBe('0.15×');
    expect(fmtX(12)).toBe('12×');
    expect(fmtX(5000)).toBe('5,000×');
  });
});

describe('the feature in words comes from the law', () => {
  const f = reefDemo().config.feature!;
  it('says what the engine runs', () => {
    expect(featureRules(f, 'Tide spins')).toEqual([
      '3 scatters award 8, 4 scatters award 12, 5 or more scatters award 16 tide spins.',
      'Every win pays ×2.',
      '3 scatters add 4 more spins during the feature.',
      'A feature has at most 20 spins.',
    ]);
    expect(multiplierNote({ ...f, multiplier: { kind: 'constant', value: 1 } })).toBe('');
    expect(multiplierNote({ ...f, multiplier: { kind: 'per_spin', start: 1, step: 1 } })).toMatch(/starts at ×1/);
  });
  it('derives the opening spins from what was played, and from the awards if the cap cut it short', () => {
    expect(initialSpins(f, 12, 4, false, 3)).toBe(8);
    expect(initialSpins(f, 3, 0, true, 4)).toBe(12);
    expect(initialSpins(f, 99, 99, true, 9)).toBe(16);
  });
});

describe('seed source and dev hooks', () => {
  const demo = reefDemo();
  it('plays a normal round from the host RNG and forces a seed once', () => {
    const src = createSeedSource(demo.engine, createRng(seededSource(7)), demo.spec.bet.coins);
    expect(src.next().seed).toBeGreaterThanOrEqual(0);
    src.forceSeed(123);
    const d = src.next();
    expect(d.seed).toBe(123);
    expect(src.next().seed).not.toBe(123);
    // The forced round is replayable: the same seed gives the same round.
    const a = demo.engine.playRound(123, seededRng32(123));
    const b = demo.engine.playRound(123, seededRng32(123));
    expect(b).toEqual(a);
  });
  it('?feature=1 finds a seed that triggers the feature', () => {
    const src = createSeedSource(demo.engine, createRng(seededSource(1)), demo.spec.bet.coins);
    const seed = src.forceFeature();
    expect(seed).not.toBeNull();
    const round = demo.engine.playRound(seed!, seededRng32(seed!));
    expect(round.feature).not.toBeNull();
    expect(src.next().seed).toBe(seed);
  });
  it('forceWin finds a big round', () => {
    const e = emberDemo(6);
    const src = createSeedSource(e.engine, createRng(seededSource(1)), e.spec.bet.coins);
    const seed = src.forceWin(20);
    expect(seed).not.toBeNull();
    expect(e.engine.playRound(seed!, seededRng32(seed!)).totalCoins).toBeGreaterThanOrEqual(20 * e.spec.bet.coins);
  });
  it('uses the engine prop when given', () => {
    const d = megaDemo();
    expect(resolveEngine({ engine: d.engine, spec: d.spec, config: d.config })).toBe(d.engine);
  });
});

describe('the demo stub engine matches the engine types', () => {
  for (const [name, make] of [['reef', reefDemo], ['ember', () => emberDemo(6)], ['mega', megaDemo]] as const) {
    it(`${name}: totals add up and boards are board[col][row]`, () => {
      const d = make();
      const bc = d.spec.bet.coins;
      let features = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const r = d.engine.playRound(seed, seededRng32(seed));
        const spin = (s: typeof r.base) => {
          expect(s.finalBoard).toEqual(s.steps[s.steps.length - 1].board);
          expect(s.steps[0].board).toHaveLength(d.spec.geometry.cols);
          const sum = s.steps.reduce((a, st) => a + st.stepCoins, 0) + s.extras.reduce((a, e) => a + e.coins, 0);
          expect(s.totalCoins).toBe(sum);
          for (const st of s.steps) for (const w of st.wins) w.cells.forEach(([c, row]) => expect(st.board[c][row]).toBeDefined());
        };
        spin(r.base);
        r.feature?.spins.forEach((f) => spin(f.result));
        expect(r.totalCoins).toBe(r.base.totalCoins + (r.feature?.totalCoins ?? 0));
        expect(r.totalCoins % 1).toBe(0);
        expect(r.totalCoins / bc).toBeGreaterThanOrEqual(0);
        if (r.feature) features++;
      }
      if (name === 'reef') expect(features).toBeGreaterThan(0);
    });
  }
});
