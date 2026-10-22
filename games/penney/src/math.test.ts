import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COINS,
  HOUSE,
  MAX_MULTIPLIER,
  PRESETS,
  RTP,
  YOURS,
  allPairs,
  cashAt,
  conwayChance,
  leading,
  pairProblem,
  progress,
  race,
  walk,
  type Race,
} from './math';

const rng = createRng(seededSource(16));
const flip = () => COINS[rng.int(2)];

/** The raw process: flip until one pattern appears at the end of the flips. */
function rawRace(you: string, house: string, start = ''): boolean {
  let flips = start;
  for (;;) {
    flips += flip();
    if (flips.endsWith(you)) return true;
    if (flips.endsWith(house)) return false;
  }
}

/** A random reachable mid-round state: the raw flips and the automaton node. */
function randomState(r: Race): { flips: string; node: string } | null {
  let flips = '';
  let node = '';
  const len = 1 + rng.int(8);
  for (let i = 0; i < len; i++) {
    const c = flip();
    const next = r.next(node, c);
    if (next === YOURS || next === HOUSE) break;
    flips += c;
    node = next;
  }
  return flips ? { flips, node } : null;
}

const pairs = allPairs();
const SAMPLE = [...PRESETS, { you: 'HHT', house: 'THH' }, { you: 'HTHT', house: 'THTH' }, { you: 'HHHHH', house: 'THHHH' }, { you: 'TH', house: 'HHH' }];

describe('Penney maths', () => {
  it('offers every pair where neither pattern contains the other', () => {
    expect(pairs.length).toBe(2900);
    expect(pairProblem('HTH', 'HTH')).not.toBeNull();
    expect(pairProblem('HT', 'HHT')).not.toBeNull();
    expect(pairProblem('THHT', 'HH')).not.toBeNull();
    expect(pairProblem('HTH', 'HHT')).toBeNull();
  });

  it("the automaton's exact odds equal Conway's leading-number formula for every pair", () => {
    // Penney's classic: HHT beats HTH 2:1, THH beats HHT 3:1, THH beats HHH 7:1.
    expect(leading('HTH', 'HTH')).toBe(5);
    expect(conwayChance('HHT', 'HTH')).toBeCloseTo(2 / 3, 15);
    expect(conwayChance('THH', 'HHT')).toBeCloseTo(3 / 4, 15);
    expect(conwayChance('THH', 'HHH')).toBeCloseTo(7 / 8, 15);
    for (const { you, house } of pairs) {
      const r = race(you, house);
      expect(Math.abs(r.p0 - conwayChance(you, house))).toBeLessThan(1e-12);
      // The max-win bound: P(A first) ≥ 2^−|A|, so the prize never exceeds MAX_MULTIPLIER.
      expect(r.p0).toBeGreaterThanOrEqual(2 ** -you.length - 1e-12);
      expect(r.prize).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    }
  });

  it('the closed form matches a direct simulation of raw coin flips', () => {
    const rounds = 20_000;
    for (const { you, house } of SAMPLE) {
      let wins = 0;
      for (let i = 0; i < rounds; i++) if (rawRace(you, house)) wins++;
      const p = conwayChance(you, house);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('each flip is a fair bet: the cash-out now is the average over heads and tails', () => {
    for (let trial = 0; trial < 3000; trial++) {
      const { you, house } = pairs[rng.int(pairs.length)];
      const r = race(you, house);
      const s = randomState(r);
      const node = s ? s.node : '';
      const now = cashAt(r, node);
      const after = (cashAt(r, r.next(node, 'H')) + cashAt(r, r.next(node, 'T'))) / 2;
      expect(Math.abs(after - now)).toBeLessThan(1e-12 * r.prize);
    }
    // At the start the cash-out is exactly RTP, so every stopping rule returns RTP.
    for (const { you, house } of SAMPLE) expect(cashAt(race(you, house), '')).toBeCloseTo(RTP, 12);
  });

  it('the meters on the board are the true matches of the tail of the flips', () => {
    for (let trial = 0; trial < 3000; trial++) {
      const { you, house } = pairs[rng.int(pairs.length)];
      const r = race(you, house);
      const s = randomState(r);
      if (!s) continue;
      expect(walk(r, s.flips)).toBe(s.node);
      // Brute force on the raw flips: the longest tail that starts each pattern.
      const brute = (p: string) => {
        let best = 0;
        for (let k = 1; k < p.length && k <= s.flips.length; k++) if (s.flips.slice(-k) === p.slice(0, k)) best = k;
        return best;
      };
      const a = progress(s.flips, you);
      const b = progress(s.flips, house);
      expect(a).toBe(brute(you));
      expect(b).toBe(brute(house));
      // The node is exactly the longer of the two matched starts.
      expect(s.node).toBe(a >= b ? you.slice(0, a) : house.slice(0, b));
    }
  });

  it('the split bar (the live win chance) is the true chance from that state', () => {
    const sims = 3000;
    let checked = 0;
    for (let trial = 0; checked < 40 && trial < 400; trial++) {
      const { you, house } = SAMPLE[trial % SAMPLE.length];
      const r = race(you, house);
      const s = randomState(r);
      if (!s) continue;
      checked++;
      const p = r.chance(s.node);
      let wins = 0;
      for (let i = 0; i < sims; i++) if (rawRace(you, house, s.flips)) wins++;
      if (r.decided(s.node)) {
        // Decided is exact: the other side never lands first from here.
        expect(p === 0 || p === 1).toBe(true);
        expect(wins).toBe(p * sims);
      } else {
        expect(Math.abs(wins / sims - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / sims) + 1e-9);
      }
    }
    expect(checked).toBe(40);
  });

  it('simulated RTP matches the manifest under many cash-out habits', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
