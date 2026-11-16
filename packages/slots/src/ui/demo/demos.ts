// DEMO ONLY. Three demo games on the real engine (`createSlot`), to show the kit on different grids and themes:
//   reef   5×3, 10 paylines, free spins with a 2× multiplier and retriggers  (Tide Chest)
//   ember  6×5 (or 8×8), pay anywhere, tumbles, orb multipliers, no feature  (Cinder Peak)
//   mega   6 reels of 2–7 rows (a height law), ways, wilds on reels 2–5      (Cinder Peak art)
// The specs are hand-written for the demo (strips and pays are not tuned) and the facts are illustrative,
// not measured. A real game keeps these in `games/<id>/src` and reads the facts from `slot-facts.json`.

import { seededSource } from '@originals/game-sdk';
import { createSlot } from '../../engine';
import type { SlotSpec } from '../../engine/types';
import type { SlotCopy, SlotEngine, SlotFacts, SlotGameConfig, SlotSymbols, SlotTheme } from '../types';
import { emberSymbols, emberTheme } from './art-ember';
import { reefSymbols, reefTheme } from './art-reef';

export interface DemoGame {
  manifest: { id: string; name: string; accent: string };
  spec: SlotSpec;
  featureSpecs: Record<string, SlotSpec>;
  config: SlotGameConfig;
  copy: SlotCopy;
  facts: SlotFacts;
  theme: SlotTheme;
  symbols: SlotSymbols;
  engine: SlotEngine;
}

type Counts = Record<number, number>;

/** A strip of `len` stops with the given symbol counts, laid out by a fixed shuffle (reproducible). */
function strip(counts: Counts, len: number, seed: number): number[] {
  const src = seededSource(seed);
  const out: number[] = [];
  for (const [id, n] of Object.entries(counts)) for (let i = 0; i < n; i++) out.push(Number(id));
  while (out.length < len) out.push(Number(Object.keys(counts).slice(-1)[0]));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(src() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, len);
}

const mkSpec = (slug: string, p: Partial<SlotSpec> & Pick<SlotSpec, 'geometry' | 'symbols' | 'evaluation' | 'pays' | 'board_law'>): SlotSpec => ({
  schema: 'game_spec_v2',
  slug,
  engine: 'reel_engine',
  bet: { coins: 100 },
  mechanics: [],
  ...p,
});

export function reefDemo(): DemoGame {
  const symbols = [
    { id: 1, label: 'SC', role: 'scatter' },
    { id: 2, label: 'WD', role: 'wild' },
    { id: 3, label: 'P1', role: 'premium' },
    { id: 4, label: 'P2', role: 'premium' },
    { id: 5, label: 'P3', role: 'premium' },
    { id: 6, label: 'P4', role: 'premium' },
    { id: 7, label: 'L1', role: 'low' },
    { id: 8, label: 'L2', role: 'low' },
    { id: 9, label: 'L3', role: 'low' },
    { id: 10, label: 'L4', role: 'low' },
  ];
  const reel = (c: number) => strip({ 1: c === 0 ? 0 : 2, 2: c === 0 || c === 4 ? 0 : 2, 3: 2, 4: 3, 5: 3, 6: 4, 7: 5, 8: 5, 9: 6, 10: 6 }, 32, 40 + c);
  const spec = mkSpec('demo-reef', {
    geometry: { cols: 5, rows: [3, 3, 3, 3, 3] },
    symbols,
    board_law: { kind: 'reel_set_mixture', reel_sets: [{ id: 'base', strips: [0, 1, 2, 3, 4].map(reel), weight: 1 }] },
    evaluation: {
      kind: 'payline',
      paylines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1]],
    },
    pays: {
      paytable: {
        '3': { '3': 100, '4': 300, '5': 1000 },
        '4': { '3': 80, '4': 200, '5': 600 },
        '5': { '3': 50, '4': 120, '5': 400 },
        '6': { '3': 40, '4': 100, '5': 300 },
        '7': { '3': 20, '4': 50, '5': 150 },
        '8': { '3': 15, '4': 40, '5': 120 },
        '9': { '3': 10, '4': 30, '5': 100 },
        '10': { '3': 10, '4': 25, '5': 80 },
      },
      scatter_pay: { '3': 200, '4': 1000, '5': 5000 },
    },
    trigger: { scatter_min: 3 },
  });
  const config: SlotGameConfig = {
    maxWinStakes: 5000,
    volatility: 'medium',
    targetRtp: 0.96,
    feature: { kind: 'free_spins', spec: 'feature.spec.json', awards: { '3': 8, '4': 12, '5': 16 }, retrigger: { '3': 4 }, maxSpins: 20, multiplier: { kind: 'constant', value: 2 } },
  };
  const featureSpecs = { 'feature.spec.json': spec };
  return {
    manifest: { id: 'slot-kit-demo', name: 'Tide Chest', accent: '#e6b450' },
    spec,
    featureSpecs,
    config,
    copy: {
      featureName: 'Tide spins',
      wildText: 'Pearl replaces all but chest',
      scatterText: 'Pays anywhere. 3+ start tide spins',
    },
    facts: { rtp: 0.96, rtpTier: 'exact', hitRate: 0.31, maxWinStakes: 5000, featureOneIn: 160, volatility: 'medium' },
    theme: reefTheme,
    symbols: reefSymbols,
    engine: createSlot({ spec, featureSpecs, feature: config.feature, maxWinStakes: config.maxWinStakes }),
  };
}

export function emberDemo(size: 6 | 8 = 6): DemoGame {
  const cols = size;
  const rows = size === 8 ? 8 : 5;
  const symbols = [
    { id: 1, label: 'SC', role: 'scatter' },
    { id: 3, label: 'P1', role: 'premium' },
    { id: 4, label: 'P2', role: 'premium' },
    { id: 5, label: 'P3', role: 'premium' },
    { id: 6, label: 'P4', role: 'premium' },
    { id: 7, label: 'L1', role: 'low' },
    { id: 8, label: 'L2', role: 'low' },
    { id: 9, label: 'L3', role: 'low' },
    { id: 10, label: 'L4', role: 'low' },
    { id: 11, label: 'OR', role: 'mid' },
  ];
  const reel = (c: number) => strip({ 1: 1, 3: 2, 4: 3, 5: 3, 6: 4, 7: 6, 8: 6, 9: 6, 10: 6, 11: 1 }, 38, 90 + c);
  const base: Record<number, number> = { 3: 50, 4: 40, 5: 30, 6: 25, 7: 10, 8: 8, 9: 6, 10: 5 };
  const brackets = (n: number) => (n < 10 ? 1 : n < 12 ? 2.5 : n < 15 ? 6 : n < 20 ? 15 : 40);
  const paytable: Record<string, Record<string, number>> = {};
  const max = cols * rows;
  for (const [id, b] of Object.entries(base)) {
    paytable[id] = {};
    for (let n = 8; n <= max; n++) paytable[id][String(n)] = Math.round(b * brackets(n));
  }
  const spec = mkSpec('demo-ember', {
    geometry: { cols, rows: Array<number>(cols).fill(rows) },
    symbols,
    board_law: { kind: 'reel_set_mixture', reel_sets: [{ id: 'base', strips: Array.from({ length: cols }, (_, c) => reel(c)), weight: 1 }] },
    evaluation: { kind: 'scatter_pays', min_count: 8 },
    pays: { paytable, scatter_pay: { '4': 300, '5': 1000, '6': 5000 } },
    mechanics: [
      { id: 'tape_continuation_refill', params: {} },
      { id: 'orb_sum_terminal', params: { orb_symbol: 11, value_pmf: { '2': 3, '3': 3, '4': 2, '5': 2, '8': 1, '10': 1 } } },
    ],
  });
  const config: SlotGameConfig = { maxWinStakes: 10000, volatility: 'high', targetRtp: 0.96 };
  return {
    manifest: { id: 'slot-kit-demo', name: 'Cinder Peak', accent: '#e879b9' },
    spec,
    featureSpecs: {},
    config,
    copy: { rule: 'Land 8+ matching symbols to win.', scatterText: 'Pays anywhere on the grid' },
    facts: { rtp: 0.9602, rtpSe: 0.0003, rtpN: 100_000_000, rtpTier: 'mc', hitRate: 0.38, maxWinStakes: 10000, volatility: 'high' },
    theme: emberTheme,
    symbols: emberSymbols,
    engine: createSlot({ spec, maxWinStakes: config.maxWinStakes }),
  };
}

export function megaDemo(): DemoGame {
  const symbols = [
    { id: 1, label: 'SC', role: 'scatter' },
    { id: 2, label: 'WD', role: 'wild' },
    { id: 3, label: 'P1', role: 'premium' },
    { id: 4, label: 'P2', role: 'premium' },
    { id: 5, label: 'P3', role: 'premium' },
    { id: 6, label: 'P4', role: 'premium' },
    { id: 7, label: 'L1', role: 'low' },
    { id: 8, label: 'L2', role: 'low' },
    { id: 9, label: 'L3', role: 'low' },
    { id: 10, label: 'L4', role: 'low' },
  ];
  const reel = (c: number) => strip({ 1: 1, 2: c === 0 || c === 5 ? 0 : 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 6, 8: 6, 9: 7, 10: 7 }, 40, 140 + c);
  const paytable: Record<string, Record<string, number>> = {
    '3': { '3': 40, '4': 100, '5': 300, '6': 800 },
    '4': { '3': 30, '4': 70, '5': 200, '6': 500 },
    '5': { '3': 20, '4': 50, '5': 120, '6': 300 },
    '6': { '3': 15, '4': 40, '5': 100, '6': 250 },
    '7': { '3': 8, '4': 20, '5': 50, '6': 120 },
    '8': { '3': 6, '4': 15, '5': 40, '6': 100 },
    '9': { '3': 5, '4': 12, '5': 30, '6': 80 },
    '10': { '3': 5, '4': 10, '5': 25, '6': 60 },
  };
  const spec = mkSpec('demo-mega', {
    geometry: { cols: 6, rows: [7, 7, 7, 7, 7, 7] },
    height_law: { kind: 'independent_categorical', reels: Array.from({ length: 6 }, () => ({ pmf: { '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1 } })) },
    symbols,
    board_law: { kind: 'reel_set_mixture', reel_sets: [{ id: 'base', strips: [0, 1, 2, 3, 4, 5].map(reel), weight: 1 }] },
    evaluation: { kind: 'ways' },
    pays: { paytable },
  });
  const config: SlotGameConfig = { maxWinStakes: 5000, volatility: 'medium', targetRtp: 0.96 };
  return {
    manifest: { id: 'slot-kit-demo', name: 'Cinder Ways', accent: '#a78bfa' },
    spec,
    featureSpecs: {},
    config,
    copy: { wildText: 'Eye replaces all but volcano' },
    facts: { rtp: 0.961, rtpTier: 'exact_mixture', hitRate: 0.42, maxWinStakes: 5000, volatility: 'medium' },
    theme: { ...emberTheme, name: 'Cinder Ways', window: { cell: 'tile', separators: 'gap', frameWidth: 8, radius: 8, cellRadius: 4 } },
    symbols: emberSymbols,
    engine: createSlot({ spec, maxWinStakes: config.maxWinStakes }),
  };
}

/** `?demo=reef|ember|ember8|mega` (default reef). */
export function pickDemo(name: string | null | undefined): DemoGame {
  switch (name) {
    case 'ember':
      return emberDemo(6);
    case 'ember8':
      return emberDemo(8);
    case 'mega':
      return megaDemo();
    default:
      return reefDemo();
  }
}
