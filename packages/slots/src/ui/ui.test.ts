// Tests for the pure parts of the slot UI kit and the demo's stub engine.
import { createRng, seededSource } from '@originals/game-sdk';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PayTableSheet } from './PayTableSheet';
import { emberDemo, megaDemo, reefDemo } from './demo/demos';
import { rtpText } from './PayTableSheet';
import { createSlot } from '../engine';
import { createSeedSource, resolveEngine, seededRng32 } from './engine-bridge';
import { anticipationPlan, bigWinTier, decorOverlays, checkCopy, countNoun, spinsNounFor, fmtHist, fmtMoney, heldByStep, pluralOf, mysterySymbol, extraLabel, featureRules, ladderOf, stepMults, waysOf, modifierStartTitle, respinsLeft, mixHex, pendingByStep, fmtX, landedCoins, landedByStep, modifierOf, modifierRuleLines, multiplierChip, multiplierValues, preReveal, roundMultiplier, valueDistribution, valueLines, howToWinLines, introLines, outroLines, ruleSentence, scatterLines, wildLines, wordCount, initialSpins, multiplierNote, parseSlotFacts, parseWinLabel, payRows, reelStopMs, reelTimings, rollMs } from './util';

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

describe('round 3: pending win in a chain, chain palette, feature kinds', () => {
  it('derives a chain board\'s pending value from the step or the engine evaluator, never from cells', () => {
    const step = (board: number[][], stepCoins: number, n: number) => ({ board, stepCoins, wins: Array.from({ length: n }, () => ({ cells: [[0, 0]] as [number, number][], coins: stepCoins, label: 'P1 x3', lineIdx: 0, ways: null })) });
    const res = { steps: [step([[1], [2]], 0, 0), step([[1], [1]], 0, 0), step([[1], [1]], 70, 1)], decor: {}, extras: [], finalBoard: [[1], [1]], flags: [], set: 0, stops: [], totalCoins: 70, trigger: null } as never;
    const seen: number[][][] = [];
    const evalBoard = (b: number[][]): [never[], number] => (seen.push(b), [[], b[0][0] === b[1][0] ? 40 : 0]);
    const p = pendingByStep(res, evalBoard as never);
    expect(p.map((x) => x.coins)).toEqual([0, 40, 70]); // evaluator for boards without wins, the engine's own stepCoins where it has them
    expect(seen).toHaveLength(2);
  });
  it('the chain palette is a light tint of the base', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#0b2a3c', '#ffffff', 0)).toBe('#0b2a3c');
    expect(mixHex('var(--x)', '#ffffff', 0.5)).toBe('var(--x)');
  });
  it('?feature=free, =respin and 1 (the declared main one) pick different rounds', () => {
    const d = reefDemo();
    const rounds = new Map<number, boolean>();
    const isFeature = (r: { feature: unknown; base: { totalCoins: number } }, kind: string) => (kind === 'respin' ? r.base.totalCoins > 0 && !r.feature : !!r.feature);
    const mk = (kind?: 'free' | 'respin' | 'main') => {
      const src = createSeedSource(d.engine, createRng(seededSource(9)), d.spec.bet.coins, undefined, isFeature as never);
      const seed = src.forceFeature(kind)!;
      const r = d.engine.playRound(seed, seededRng32(seed));
      rounds.set(seed, !!r.feature);
      return r;
    };
    expect(mk('free').feature).not.toBeNull();
    expect(mk('respin').feature).toBeNull();
    expect(mk().feature).not.toBeNull(); // 'main' here is free spins
  });
});

describe('round 5: no spoilers, ladder, ways', () => {
  it('a chain announces its opening respins, and counts what is left from the past only', () => {
    const spec = (params: object) => ({ mechanics: [{ id: 'hold_and_spin_lock_respin', params }] }) as never;
    expect(modifierStartTitle(spec({ respins: 3 }))).toEqual({ title: '3 respins', initial: 3 });
    expect(modifierStartTitle({ mechanics: [{ id: 'sticky_respin', params: { max_respins: 4 } }] } as never)).toEqual({ title: 'Up to 4 respins', initial: null, max: 4 });
    expect(modifierStartTitle({ mechanics: [] } as never)).toBeNull();
    // coins land at steps 1 and 4: respins left reset to 3 each time a new coin lands
    expect([0, 1, 2, 3, 4, 5].map((j) => respinsLeft([0, 10, 10, 10, 20, 20], j, 3))).toEqual([3, 3, 2, 1, 3, 2]);
  });
  it('reads the cascade ladder and its per-step factors, and the ways of stopped reels', () => {
    expect(ladderOf({ mechanics: [{ id: 'cascade_step_ladder', params: { ladder: [1, 2, 3, 5, 8] } }] } as never)).toEqual([1, 2, 3, 5, 8]);
    expect(ladderOf({ mechanics: [] } as never)).toEqual([]);
    expect(stepMults({ 'cascade_step_ladder.stepMults': [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(stepMults(undefined)).toEqual([]);
    expect(waysOf([2, 3, null, 4])).toBe(24);
    expect(waysOf([null, null])).toBeNull();
  });
});

describe('paytable order', () => {
  it('copy.paytableFirst puts key symbols before the pays', () => {
    const d = reefDemo();
    const html = (first?: number[]) => renderToStaticMarkup(createElement(PayTableSheet, { spec: d.spec, symbols: d.symbols, config: d.config, copy: { ...d.copy, paytableFirst: first }, facts: d.facts, theme: d.theme }));
    const plain = html(undefined);
    expect(plain.indexOf('Angelfish')).toBeLessThan(plain.indexOf('Pearl in shell'));
    const keyed = html([2, 1]);
    expect(keyed.indexOf('Pearl in shell')).toBeLessThan(keyed.indexOf('Angelfish'));
  });
});

describe('round 6: win labels from every evaluator', () => {
  const labelsOf = (spec: never, n = 400) => {
    const slot = createSlot({ spec, maxWinStakes: 5000 });
    const out = new Set<string>();
    for (let s = 1; s <= n; s++) for (const st of slot.playRound(s, seededRng32(s)).base.steps) for (const w of st.wins) out.add(w.label);
    return [...out];
  };
  const cases: [string, () => ReturnType<typeof reefDemo>, (spec: ReturnType<typeof reefDemo>['spec']) => unknown][] = [
    ['payline', () => reefDemo(), (s) => s],
    ['ways', () => megaDemo(), (s) => s],
    ['scatter pays (count)', () => emberDemo(6), (s) => s],
    ['cluster', () => emberDemo(6), (s) => ({ ...s, evaluation: { kind: 'cluster', min_size: 5, adjacency: '4' }, pays: { ...s.pays, paytable: Object.fromEntries(Object.entries(s.pays.paytable).map(([id]) => [id, Object.fromEntries([5, 6, 7, 8, 9].map((k) => [String(k), 10 * k]))])) } })],
  ];
  for (const [name, make, tweak] of cases) {
    it(`${name}: every real label parses to a known symbol label and a count`, () => {
      const d = make();
      const labels = labelsOf(tweak(d.spec) as never);
      expect(labels.length).toBeGreaterThan(0);
      const known = new Set(d.spec.symbols.map((s) => s.label));
      for (const l of labels) {
        const p = parseWinLabel(l);
        expect(p, l).not.toBeNull();
        expect(known.has(p!.symbol), l).toBe(true);
        expect(p!.count).toBeGreaterThan(0);
      }
      if (name === 'cluster') expect(labels.every((l) => l.startsWith('cluster '))).toBe(true);
    });
  }
  it('also reads the suffix forms', () => {
    expect(parseWinLabel('P1 x4 (from reel 2)')).toEqual({ symbol: 'P1', count: 4 });
    expect(parseWinLabel('P1 x4 (right)')).toEqual({ symbol: 'P1', count: 4 });
    expect(parseWinLabel('WD x3 (wild own pay)')).toEqual({ symbol: 'WD', count: 3 });
    expect(parseWinLabel('L2 x3 (4 paths, connected)')).toEqual({ symbol: 'L2', count: 3 });
    expect(parseWinLabel('cluster L1 x10')).toEqual({ symbol: 'L1', count: 10 });
  });
});

describe('round 7: held cells and copy check', () => {
  it('held cells are coins that have landed or locked cells, from the step they hold their final symbol', () => {
    const b = (...c: number[][]) => c;
    const steps = [b([1, 0], [0, 0]), b([1, 0], [0, 9]), b([1, 9], [0, 9])];
    const res = { steps: steps.map((board) => ({ board, stepCoins: 0, wins: [] })), finalBoard: steps[2], decor: { 'x.heldVals': { '0,0': 1, '1,1': 2, '0,1': 3 } }, extras: [], flags: [], set: 0, stops: [], totalCoins: 0, trigger: null } as never;
    expect(heldByStep(res).map((s) => [...s].sort())).toEqual([['0,0'], ['0,0', '1,1'], ['0,0', '0,1', '1,1']]);
    const locked = { ...(res as object), decor: { 'sticky_respin.locked': [[0, 0], [1, 1]] } } as never;
    expect(heldByStep(locked).map((s) => s.size)).toEqual([1, 2, 2]);
  });
  it('checkCopy names every game line of 9 or more words (blind reviewers cannot see them)', () => {
    expect(checkCopy({ rule: 'Match three on a line to win', wildText: 'The worker bee stands in for every symbol except honey cells.', modifierRules: ['Short one', 'This rule line has far too many words to be read'] })).toEqual([
      { field: 'wildText', text: 'The worker bee stands in for every symbol except honey cells.', words: 11 },
      { field: 'modifierRules[1]', text: 'This rule line has far too many words to be read', words: 11 },
    ]);
    expect(checkCopy(undefined)).toEqual([]);
    expect(checkCopy({ extrasLabels: { A: 'one two three four five six seven eight nine' } })).toHaveLength(1);
  });
});

describe('round 8: paytable wording', () => {
  const sheet = (d: ReturnType<typeof reefDemo>, copy = d.copy) => renderToStaticMarkup(createElement(PayTableSheet, { spec: d.spec, symbols: d.symbols, config: d.config, copy, facts: d.facts, theme: d.theme }));
  it('a mystery symbol opens into one symbol, and symbolText overrides any line', () => {
    const d = reefDemo('mystery');
    expect(mysterySymbol(d.spec)).toBe(11);
    expect(sheet(d)).toContain('Opens into one symbol');
    expect(sheet(d, { ...d.copy, symbolText: { 11: 'A folded clam', 3: 'Top fish' } })).toMatch(/A folded clam[\s\S]*Top fish|Top fish[\s\S]*A folded clam/);
    expect(sheet(d, { ...d.copy, symbolText: { 11: 'A folded clam' } })).not.toContain('Opens into one symbol');
    expect(checkCopy({ symbolText: { 3: 'one two three four five six seven eight nine' } })).toHaveLength(1);
  });
  it('the rules name the scatter symbol, with "scatters" as the fallback', () => {
    expect(pluralOf('Sun')).toBe('suns');
    expect(pluralOf('Treasure chest')).toBe('treasure chests');
    expect(pluralOf('Fox')).toBe('foxes');
    expect(pluralOf('Berry')).toBe('berries');
    expect(pluralOf(undefined)).toBe('scatters');
    const d = reefDemo();
    expect(sheet(d)).toContain('3 treasure chests: 8 tide spins');
    expect(featureRules(d.config.feature!, 'Tide spins')[0]).toBe('3 scatters: 8 tide spins');
  });
});

describe('round 9: a paying win is never shown as zero', () => {
  it('money keeps two significant digits under 0.01', () => {
    expect(fmtMoney(0.0045)).toBe('0.0045');
    expect(fmtMoney(0.004)).toBe('0.004');
    expect(fmtMoney(0.00001)).toBe('0.00001');
    expect(fmtMoney(0.0099)).toBe('0.0099');
    expect(fmtMoney(0.5)).toBe('0.50');
    expect(fmtMoney(0)).toBe('0.00');
    expect(fmtMoney(1234.5)).toBe('1234.50');
    // 3,125 ways: 3 of a kind pays about 0.0045 of the bet, at a 1.00 stake
    expect(fmtMoney((14 / 3125) * 1)).not.toBe('0.00');
  });
  it('history chips keep tiny multiples and show a loss as 0.00×', () => {
    expect(fmtHist(0.0045)).toBe('0.0045×');
    expect(fmtHist(0)).toBe('0.00×');
    expect(fmtHist(3.36)).toBe('3.36×');
  });
});

describe('round 10: rules from the config', () => {
  const f = (o: object) => ({ kind: 'free_spins', spec: 'x', awards: { '3': 5 }, maxSpins: 5, multiplier: { kind: 'constant', value: 1 }, ...o }) as never;
  it('says "No retriggers" and shows the cap only where it can bind', () => {
    expect(featureRules(f({}), 'Free folds', 'scatters', 'free folds')).toEqual(['3 scatters: 5 free folds', 'No retriggers']);
    expect(featureRules(f({ maxSpins: 4 }), 'Free folds', 'scatters', 'free folds')).toContain('At most 4 spins');
    const withRetrigger = featureRules(f({ retrigger: { '3': 2 } }), 'Free folds', 'scatters', 'free folds');
    expect(withRetrigger).toContain('Retrigger: 3 scatters, +2 spins');
    expect(withRetrigger).toContain('At most 5 spins in total');
    expect(withRetrigger).not.toContain('No retriggers');
  });
});

describe('round 11: rule lines read as sentences', () => {
  // Noodle Cart: the scatter is "Order ticket", the feature "Dinner rush" with its own spins noun.
  const noodle = { kind: 'free_spins', spec: 'feature.spec.json', awards: { '3': 5 }, retrigger: { '1': 1 }, maxSpins: 20, multiplier: { kind: 'per_retrigger', start: 1, step: 1 } } as never;
  it('uses the spins noun, and pluralises the symbol and the spins by count', () => {
    expect(featureRules(noodle, 'Dinner rush', pluralOf('Order ticket'), 'rush spins', 'order ticket')).toEqual([
      '3 order tickets: 5 rush spins',
      'Multiplier starts ×1, +1 per retrigger',
      'Retrigger: 1 order ticket, +1 spin',
      'At most 20 spins in total',
    ]);
    // without the copy noun it falls back to "free spins"
    expect(featureRules(noodle, 'Dinner rush', 'order tickets', undefined, 'order ticket')[0]).toBe('3 order tickets: 5 free spins');
  });
  it('a feature name that already ends in "spins" is used as it is', () => {
    expect(spinsNounFor('Tide spins')).toBe('tide spins');
    expect(spinsNounFor('Dinner rush')).toBe('free spins');
    expect(spinsNounFor('Dinner rush', 'rush spins')).toBe('rush spins');
    expect(featureRules(reefDemo().config.feature!, 'Tide spins')[0]).toBe('3 scatters: 8 tide spins');
  });
  it('countNoun and pluralOf pick singular for one', () => {
    expect([1, 2].map((n) => countNoun(n, 'spins'))).toEqual(['spin', 'spins']);
    expect(countNoun(1, 'berries')).toBe('berry');
    expect(countNoun(1, 'foxes')).toBe('fox');
    expect(countNoun(1, 'order tickets', 'order ticket')).toBe('order ticket');
    expect(pluralOf('Order ticket', 1)).toBe('order ticket');
    expect(pluralOf('Order ticket', 3)).toBe('order tickets');
    expect(pluralOf(undefined, 1)).toBe('scatter');
  });
  it('the cards count the same way', () => {
    expect(introLines(1, '', 'order tickets', 'order ticket')[0]).toBe('1 order ticket');
    expect(introLines(3, '', 'order tickets', 'order ticket')[0]).toBe('3 order tickets');
    expect(outroLines(1, 5, false, 'rush spins')[0]).toBe('1 rush spin');
  });
});
