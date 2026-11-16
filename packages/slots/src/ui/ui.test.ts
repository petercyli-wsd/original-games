// Tests for the pure parts of the slot UI kit and the demo's stub engine.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { emberDemo, megaDemo, reefDemo } from './demo/demos';
import { rtpText } from './PayTableSheet';
import { createSeedSource, resolveEngine, seededRng32 } from './engine-bridge';
import { anticipationPlan, bigWinTier, decorOverlays, extraLabel, featureRules, fmtX, landedCoins, landedByStep, modifierOf, modifierRuleLines, multiplierChip, multiplierValues, preReveal, roundMultiplier, valueDistribution, valueLines, howToWinLines, introLines, outroLines, ruleSentence, scatterLines, wildLines, wordCount, initialSpins, multiplierNote, parseSlotFacts, parseWinLabel, payRows, reelStopMs, reelTimings, rollMs } from './util';

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
  it('says what the engine runs, in short lines', () => {
    expect(featureRules(f, 'Tide spins')).toEqual([
      '3 scatters: 8 tide spins',
      '4 scatters: 12 tide spins',
      '5+ scatters: 16 tide spins',
      'Every win ×2',
      'Retrigger: 3 scatters, +4 spins',
      'At most 20 spins in total',
    ]);
    expect(multiplierNote({ ...f, multiplier: { kind: 'constant', value: 1 } })).toBe('');
    expect(multiplierNote({ ...f, multiplier: { kind: 'per_spin', start: 1, step: 1 } })).toMatch(/starts ×1/);
  });
  it('every kit-generated line is under 9 words (the blind player hides longer text)', () => {
    for (const d of [reefDemo(), emberDemo(6), megaDemo()]) {
      const name = d.copy.featureName ?? 'Free spins';
      const f = d.config.feature;
      const lines = [
        ...howToWinLines(d.spec, d.copy),
        ...wildLines(d.copy),
        ...scatterLines(d.spec.trigger?.scatter_min ?? 3, f ? name : null, d.copy),
        ...(f ? [...featureRules(f, name), ...introLines(5, multiplierNote(f)), ...outroLines(20, 123.4, true)] : []),
        ...scatterLines(3, 'A long feature name', undefined),
        ...wildLines(undefined),
        ...(['payline', 'ways', 'cluster', 'scatter_pays'] as const).map((kind) => ruleSentence({ ...d.spec, evaluation: { ...d.spec.evaluation, kind } }, undefined)),
        rtpText(d.facts),
      ];
      for (const l of lines) expect(wordCount(l), l).toBeLessThan(9);
    }
    for (const m of [{ kind: 'per_spin', start: 1, step: 1 }, { kind: 'per_retrigger', start: 2, step: 2 }] as const) {
      expect(wordCount(multiplierNote({ ...reefDemo().config.feature!, multiplier: m }))).toBeLessThan(9);
    }
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
  it('?feature=1 starts from a different seed on every call and stays replayable', () => {
    const seen = new Set<number>();
    for (let i = 1; i <= 6; i++) {
      const src = createSeedSource(demo.engine, createRng(seededSource(100 + i)), demo.spec.bet.coins);
      const seed = src.forceFeature()!;
      seen.add(seed);
      expect(demo.engine.playRound(seed, seededRng32(seed)).feature).not.toBeNull();
    }
    expect(seen.size).toBeGreaterThan(3);
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

describe('round 2: modifier features, labels, multipliers, mystery reveal', () => {
  it('never shows raw engine extras labels; the default is neutral and a game can map them', () => {
    expect(extraLabel('HOLD & SPIN: 9 coins')).toBe('Bonus total');
    expect(extraLabel('ORB SUM x35')).toBe('Bonus ×35');
    expect(extraLabel('SCATTER PAY (3 scatters)')).toBe('Scatter pay');
    expect(extraLabel('Honey Harvest: 9 cells')).toBe('Honey Harvest: 9 cells'); // already the game's words
    expect(extraLabel('HOLD & SPIN: 9 coins', { 'HOLD & SPIN': 'Noodle haul' })).toBe('Noodle haul');
    expect(extraLabel('ORB SUM x3', (r) => r.toLowerCase())).toBe('orb sum x3');
  });
  it('sums the multiplier the engine applied', () => {
    expect(roundMultiplier({ 'global_additive.gwm': 6, 'global_additive.wildMults': { '1,1': 2, '2,0': 3 } })).toEqual({ total: 6, parts: [2, 3], kind: 'additive' });
    expect(multiplierChip(roundMultiplier({ 'global_additive.gwm': 6, 'global_additive.wildMults': { '1,1': 2, '2,0': 3 } })!)).toBe('Multiplier ×6 (1 + 5)');
    expect(roundMultiplier({ 'global_iid.mult': 5 })).toEqual({ total: 5, kind: 'reel' });
    expect(roundMultiplier({ 'global_iid.mult': 1 })).toBeNull();
    expect(roundMultiplier({ 'orb_sum_terminal.orbVals': { '0,0': 2, '1,1': 3 } })?.total).toBe(5);
    expect(roundMultiplier({})).toBeNull();
    expect(decorOverlays({ 'global_additive.wildMults': { '2,2': 3 } }).get('2,2')).toBe('+3');
  });
  it('tiny pays keep their digits', () => {
    expect(fmtX(0.0045)).toBe('0.0045×');
    expect(fmtX(0.00002)).toBe('0.00002×');
    expect(fmtX(0.15)).toBe('0.15×');
  });
  it('value symbols show what they can take', () => {
    const d = emberDemo(6);
    const dist = valueDistribution(d.spec, 11)!;
    expect(dist.kind).toBe('mult');
    expect(valueLines(dist, 100)).toEqual(['Value ×2 to ×10', 'Most often ×2']);
    expect(valueDistribution(d.spec, 3)).toBeNull();
    expect(multiplierValues(reefDemo('marquee').spec)).toEqual([1, 2, 3, 5, 10]);
  });
  it('rebuilds the board before a mystery reveal from the stops and strips', () => {
    const d = reefDemo('mystery');
    let found = 0;
    for (let seed = 1; seed <= 300 && found < 5; seed++) {
      const r = d.engine.playRound(seed, seededRng32(seed));
      const pre = preReveal(d.spec, r.base);
      if (!pre) continue;
      found++;
      const revealed = r.base.decor['mystery_reveal.mysteryReveal'] as number;
      for (const [c, row] of pre.cells) {
        expect(pre.board[c][row]).toBe(11); // the mystery symbol is visible before the flip
        expect(r.base.steps[0].board[c][row]).toBe(revealed); // and becomes the revealed symbol
      }
      pre.board.forEach((col, c) => col.forEach((v, row) => pre.cells.some(([cc, rr]) => cc === c && rr === row) || expect(v).toBe(r.base.steps[0].board[c][row])));
    }
    expect(found).toBeGreaterThan(0);
  });
  it('finds respin chains as a modifier feature, with the coins landing by step', () => {
    const board = (...cols: number[][]) => cols;
    const spin = (steps: number[][][], decor: Record<string, unknown>) =>
      ({ steps: steps.map((b) => ({ board: b, stepCoins: 0, wins: [] })), finalBoard: steps[steps.length - 1], decor, extras: [], flags: [], set: 0, stops: [], totalCoins: 0, trigger: null }) as never;
    const res = spin([board([1, 0], [0, 0]), board([1, 0], [0, 9]), board([1, 9], [0, 9])], { 'x.heldVals': { '0,0': 100, '1,1': 200, '0,1': 300 }, 'x.respins': 2 });
    expect(modifierOf(res)).toEqual({ respins: 2 });
    expect(landedCoins(res)).toEqual([100, 300, 600]);
    expect([...landedByStep(res, 100, {})[0].keys()]).toEqual(['0,0']);
    expect(modifierOf(spin([board([1], [2])], {}))).toBeNull();
    expect(modifierOf(spin([board([1], [2])], {}), () => true)).toEqual({ respins: 0 });
  });
  it('writes paytable lines for a hold-and-spin mechanic, each under 9 words', () => {
    const spec = { mechanics: [{ id: 'hold_and_spin_lock_respin', params: { coin_symbol: 11, entry_min: 6, respins: 3, full_grid_bonus: 5 } }] } as never;
    const lines = modifierRuleLines(spec, () => 'Honey');
    expect(lines).toContain('6+ honeys start the bonus');
    for (const l of lines) expect(wordCount(l)).toBeLessThan(9);
  });
  it('forceFeature also finds modifier features when told what counts', () => {
    const d = reefDemo();
    const src = createSeedSource(d.engine, createRng(seededSource(3)), d.spec.bet.coins, undefined, (r) => r.base.totalCoins > 0 && !r.feature);
    const seed = src.forceFeature()!;
    const r = d.engine.playRound(seed, seededRng32(seed));
    expect(r.feature).toBeNull();
    expect(r.base.totalCoins).toBeGreaterThan(0);
  });
});
