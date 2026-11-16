// Honeycomb maths checks: oracle parity, the RTP, the respin feature against an independent model, the queen's
// rule (a queen on the last respin multiplies the whole round), the max-win cap, the base honey counter and the
// spin flow (draw after place).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSlot, type SlotSpec, type SpinResult } from '@originals/slots';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { checkCopy } from '@originals/slots/ui';
import { HONEY, QUEEN, copy } from './copy';
import { HONEY_NEEDED, honeyCount } from './Game';
import { featureStats } from './maths';
import config from './slot.config.json';
import specJson from './slot.spec.json';
import facts from './slot-facts.json';

const here = dirname(fileURLToPath(import.meta.url));
const spec = specJson as unknown as SlotSpec;
const oracle = JSON.parse(readFileSync(join(here, 'oracle.json'), 'utf8'));
const BET = spec.bet.coins;
const HELD = 'hold_and_spin_lock_respin.heldVals';
const ORBS = 'orb_sum_terminal.orbVals';
const stats = featureStats(spec, 1_000_000, 99);

const harvestOf = (r: SpinResult) => r.extras.find((e) => e.label.startsWith('HOLD & SPIN'))?.coins ?? 0;
const queenOf = (r: SpinResult) => r.extras.find((e) => e.label.startsWith('ORB SUM'))?.coins ?? 0;
const lineTotal = (r: SpinResult) => r.steps[0].wins.reduce((a, w) => a + w.coins, 0);

describe('oracle parity', () => {
  it('the TypeScript spins equal the pack for all 2,000 seeds', () => {
    const b = oracle.base;
    const fx: OracleFixture = { schema: 'slot_oracle_v1', spec, packVersion: oracle.packVersion, specHash: b.specHash, context: b.context, families: b.families, decorSchema: b.decorSchema, seeds: b.seeds, spinHashes: b.spinHashes, fullSeeds: b.fullSeeds, spins: b.spins };
    const r = checkParity(fx);
    expect(r.firstMismatch).toBeNull();
    expect(r.seeds).toBe(2000);
  }, 120_000);

  it('the pack accepted a ways spec with hold-and-respin and the queen (orb sum)', () => {
    expect(oracle.base.context).toBe('ways|global_mixture');
    expect(oracle.base.families).toEqual(['hold_and_spin_lock_respin', 'orb_sum_terminal']);
  });
});

describe('RTP', () => {
  it('the facts file states 96% (Monte Carlo, with its error) inside the 95.5–96.5% band', () => {
    expect(facts.rtpTier).toBe('mc');
    expect(Math.abs(facts.rtp - 0.96)).toBeLessThan(0.005);
    expect(facts.rtpSe).toBeLessThan(0.002);
  });
  it('the pack Monte Carlo agrees with the facts within 4 SE', () => {
    const a = oracle.base.analytics;
    expect(a.tier).toBe('mc');
    expect(Math.abs(a.rtp - facts.rtpUncapped)).toBeLessThan(4 * Math.hypot(a.rtp_se, facts.rtpUncappedSe));
  });
});

describe('respin feature', () => {
  // Engine rounds that ran the harvest: the cells' total, whether a queen fired.
  const slot = createSlot({ spec, maxWinStakes: 1e9 });
  const rounds: SpinResult[] = [];
  for (let seed = 1; rounds.length < 4000 && seed < 3_000_000; seed++) {
    const r = slot.spin(seed);
    if (r.decor[HELD]) rounds.push(r);
  }

  it('the engine harvest matches the independent respin model within 4 SE', () => {
    expect(rounds.length).toBe(4000);
    const xs = rounds.map((r) => harvestOf(r) / BET);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const se = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length / xs.length);
    expect(Math.abs(mean - stats.harvest)).toBeLessThan(4 * Math.hypot(se, stats.se));
  });

  it('the queen fires on the last respin as often as the model says (within 4 SE)', () => {
    const p = rounds.filter((r) => queenOf(r) > 0).length / rounds.length;
    const se = Math.sqrt((stats.pQueen * (1 - stats.pQueen)) / rounds.length);
    expect(Math.abs(p - stats.pQueen)).toBeLessThan(4 * se + 0.002);
  });

  it('starts with honey on all 5 reels, 1 in about 175 spins', () => {
    expect(HONEY_NEEDED).toBe(5);
    expect(1 / stats.pTrig).toBeGreaterThan(160);
    expect(1 / stats.pTrig).toBeLessThan(190);
    expect(Math.abs(facts.featureFreq * stats.pTrig - 1)).toBeLessThan(0.02);
    // at most one honey cell per reel window, so 5 means one on every reel
    for (const strip of (spec.board_law.reel_sets as { strips: number[][] }[])[0].strips) {
      const at = strip.flatMap((s, i) => (s === HONEY ? [i] : []));
      for (let i = 0; i < at.length; i++) expect((at[(i + 1) % at.length] - at[i] + strip.length) % strip.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('a full comb is reachable: about 1 harvest in 150', () => {
    expect(stats.pFull).toBeGreaterThan(1 / 300);
    expect(stats.pFull).toBeLessThan(1 / 75);
    const p = spec.mechanics[0].params as { full_grid_bonus: number };
    expect(p.full_grid_bonus).toBe(1000);
  });
});

describe('the queen', () => {
  const slot = createSlot({ spec, maxWinStakes: 1e9 });
  it('a queen on the last respin multiplies the whole round by the sum of the queens', () => {
    let checked = 0;
    for (let seed = 1; checked < 40 && seed < 3_000_000; seed++) {
      const r = slot.spin(seed);
      if (!r.decor[HELD] || !queenOf(r)) continue;
      const orbs = r.decor[ORBS] as Record<string, number>;
      const held = r.decor[HELD] as Record<string, number>;
      const last = r.steps[r.steps.length - 1].board;
      const s = Object.values(orbs).reduce((a, b) => a + b, 0);
      for (const key of Object.keys(orbs)) {
        const [c, row] = key.split(',').map(Number);
        expect(last[c][row]).toBe(QUEEN); // she stands on the final board
        expect(key in held).toBe(false); // never on a honey cell
      }
      expect(queenOf(r)).toBe((lineTotal(r) + harvestOf(r)) * (s - 1));
      expect(r.totalCoins).toBe((lineTotal(r) + harvestOf(r)) * s);
      checked++;
    }
    expect(checked).toBe(40);
  });

  it('a queen seen on an earlier respin, gone from the last one, multiplies nothing', () => {
    let found = 0;
    for (let seed = 1; found < 10 && seed < 3_000_000; seed++) {
      const r = slot.spin(seed);
      if (!r.decor[HELD]) continue;
      const last = r.steps[r.steps.length - 1].board;
      const earlier = r.steps.slice(1, -1).some((st) => st.board.some((col) => col.includes(QUEEN)));
      if (earlier && !last.some((col) => col.includes(QUEEN))) {
        expect(queenOf(r)).toBe(0);
        expect(r.totalCoins).toBe(lineTotal(r) + harvestOf(r));
        found++;
      }
    }
    expect(found).toBe(10);
  });

  it('in the base game a queen multiplies the line wins on her board, and never a board with no win', () => {
    let multiplied = 0;
    for (let seed = 1; seed < 200_000; seed++) {
      const r = slot.spin(seed);
      if (r.decor[HELD]) continue;
      const queens = r.finalBoard.flat().filter((s) => s === QUEEN).length;
      const orbs = r.decor[ORBS] as Record<string, number> | undefined;
      if (lineTotal(r) === 0) {
        expect(queenOf(r)).toBe(0);
        continue;
      }
      if (!queens) continue;
      const s = Object.values(orbs!).reduce((a, b) => a + b, 0);
      expect(Object.keys(orbs!).length).toBe(queens);
      expect(r.totalCoins).toBe(lineTotal(r) * s);
      multiplied++;
    }
    expect(multiplied).toBeGreaterThan(1000);
  });

  it('queens are ×2 to ×10', () => {
    const p = spec.mechanics.find((m) => m.id === 'orb_sum_terminal')!.params as { value_pmf: Record<string, number>; multiply_extras: boolean };
    const v = Object.keys(p.value_pmf).map(Number);
    expect(Math.min(...v)).toBe(2);
    expect(Math.max(...v)).toBe(10);
    expect(p.multiply_extras).toBe(true);
  });
});

describe('max win', () => {
  it('declares a cap the harvest can really reach', () => {
    expect(facts.maxWin).toBe(config.maxWinStakes);
    expect(facts.pMaxWin).toBeGreaterThan(1e-9);
  });
  it('no round pays above the cap, and a capped round pays exactly the cap', () => {
    const cap = 8;
    const slot = createSlot({ spec, maxWinStakes: cap });
    let capped = 0;
    for (let seed = 1; seed < 40_000; seed++) {
      const r = slot.playRound(seed, () => 0);
      expect(r.totalCoins).toBeLessThanOrEqual(cap * BET);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(cap * BET);
      }
    }
    expect(capped).toBeGreaterThan(0);
    const real = createSlot({ spec, maxWinStakes: config.maxWinStakes });
    for (let seed = 1; seed < 20_000; seed++) expect(real.playRound(seed, () => 0).totalCoins).toBeLessThanOrEqual(config.maxWinStakes * BET);
  });
});

describe('base honey counter', () => {
  const board = (cells: number[][], decor?: Record<string, unknown>) => {
    const seen = { n: 0 };
    const out: (string | null)[] = [];
    cells.forEach((col, c) => col.forEach((symbol, row) => out.push(honeyCount(seen, { col: c, row, symbol, decor }))));
    return out.filter((x) => x !== null);
  };
  const b = [
    [6, HONEY, 7, 8, 9],
    [HONEY, 6, 7, 8, 9],
    [6, 7, 8, 9, 10],
    [6, 7, HONEY, 8, 9],
    [6, 7, 8, 9, HONEY],
  ];
  it('counts the honey cells toward 5 once the board has landed', () => {
    expect(board(b, {})).toEqual(['1/5', '2/5', '3/5', '4/5']);
  });
  it('shows nothing while the reels spin, and nothing in the harvest', () => {
    expect(board(b)).toEqual([]);
    expect(board(b, { [HELD]: {} })).toEqual([]);
  });
});

describe('spin flow', () => {
  it('the kit draws the seed only after the bet is placed, and Honeycomb uses the kit engine', () => {
    const kit = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
    const play = kit.slice(kit.indexOf('async function play('));
    expect(play.indexOf('await ticket.place(')).toBeGreaterThan(-1);
    expect(play.indexOf('await ticket.place(')).toBeLessThan(play.indexOf('seeds.next()'));
    expect(play.indexOf('seeds.next()')).toBeLessThan(play.indexOf('engine.playRound('));
    expect(play).toContain('if (busyRef.current) return null;');
    const game = readFileSync(join(here, 'Game.tsx'), 'utf8');
    expect(game).not.toContain('engine=');
    expect(game).not.toMatch(/useHost|Math\.random/);
    expect(readFileSync(join(here, 'copy.ts'), 'utf8')).toContain('extrasLabels');
  });
});

describe('copy', () => {
  it('every line is under 9 words', () => {
    expect(checkCopy(copy)).toEqual([]);
  });
  it('the paytable lines for the queen and the honey cell state the spec\'s values', () => {
    const q = spec.mechanics.find((m) => m.id === 'orb_sum_terminal')!.params as { value_pmf: Record<string, number> };
    const h = spec.mechanics[0].params as { value_pmf: Record<string, number> };
    const qv = Object.keys(q.value_pmf).map(Number);
    const hv = Object.keys(h.value_pmf).map((k) => Number(k) / BET);
    expect(copy.symbolText![QUEEN]).toContain(`×${Math.min(...qv)} to ×${Math.max(...qv)}`);
    expect(copy.symbolText![HONEY]).toContain(`×${Math.min(...hv)} to ×${Math.max(...hv)}`);
    const cap = config.maxWinStakes.toLocaleString('en-US');
    expect(copy.modifierRules).toContain(`Total win is capped at ${cap}×.`);
  });
  it('the queen rule is on the intro card and under the board during the harvest', () => {
    expect(copy.modifierIntro).toMatch(/queen/i);
    expect(copy.chainRule).toMatch(/queen/i);
  });
});
