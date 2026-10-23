import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  LINES,
  MAPS,
  MAP_KEYS,
  MAX_WIN,
  RTP,
  SIDES,
  TOTAL,
  callRegion,
  decided,
  emptyCalls,
  finalDist,
  maxStartPrize,
  nextOdds,
  relock,
  startChance,
  tally,
  winChance,
  winsAt,
  type Bet,
  type Call,
  type MapDef,
} from './math';

const rng = createRng(seededSource(7));
const BETS: Bet[] = SIDES.flatMap((side) => LINES.map((line) => ({ side, line })));

/** A random reachable state: call k random regions with their true chances. */
function randomState(m: MapDef, k: number): Call[] {
  const calls = emptyCalls(m);
  for (const j of rng.shuffle(m.regions.map((_, i) => i)).slice(0, k)) calls[j] = callRegion(rng.next(), m.regions[j].p);
  return calls;
}

/** Brute force over all 2^u colourings of the uncalled regions. */
function bruteChance(m: MapDef, calls: readonly Call[], bet: Bet): number {
  const open = m.regions.map((_, i) => i).filter((i) => calls[i] === null);
  const { blue } = tally(m, calls);
  let p = 0;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    let pr = 1;
    let s = blue;
    open.forEach((i, b) => {
      const r = m.regions[i];
      if (mask & (1 << b)) {
        pr *= r.p;
        s += r.w;
      } else pr *= 1 - r.p;
    });
    if (winsAt(s, bet)) p += pr;
  }
  return p;
}

describe('Majority maths', () => {
  it('every map has 12–18 regions whose weights sum to 100, with chances strictly inside (0, 1)', () => {
    for (const k of MAP_KEYS) {
      const m = MAPS[k];
      expect(m.regions.length).toBeGreaterThanOrEqual(12);
      expect(m.regions.length).toBeLessThanOrEqual(18);
      expect(m.regions.reduce((a, r) => a + r.w, 0)).toBe(TOTAL);
      for (const r of m.regions) expect(r.p > 0 && r.p < 1 && Number.isInteger(r.w) && r.w > 0).toBe(true);
      const cells = new Set(m.regions.map((r) => `${r.col},${r.row}`));
      expect(cells.size).toBe(m.regions.length);
    }
  });

  it('the subset-sum convolution matches brute-force enumeration', () => {
    for (const k of MAP_KEYS) {
      const m = MAPS[k];
      for (let t = 0; t < 6; t++) {
        const calls = randomState(m, Math.max(0, m.regions.length - 12 + rng.int(4)));
        const d = finalDist(m, calls);
        expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        for (const bet of BETS) expect(winChance(m, calls, bet)).toBeCloseTo(bruteChance(m, calls, bet), 12);
      }
    }
  });

  it('start odds match a direct simulation of the raw map', () => {
    const rounds = 30_000;
    for (const k of MAP_KEYS) {
      const m = MAPS[k];
      const hits = BETS.map(() => 0);
      for (let r = 0; r < rounds; r++) {
        let s = 0;
        for (const reg of m.regions) if (rng.next() < reg.p) s += reg.w;
        BETS.forEach((b, i) => winsAt(s, b) && hits[i]++);
      }
      BETS.forEach((b, i) => {
        const p = startChance(k, b);
        expect(Math.abs(hits[i] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
      });
    }
  });

  it('martingale: the next call’s two outcomes average back to the odds now', () => {
    for (const k of MAP_KEYS) {
      const m = MAPS[k];
      for (let t = 0; t < 40; t++) {
        const calls = randomState(m, rng.int(m.regions.length));
        const open = m.regions.map((_, i) => i).filter((i) => calls[i] === null);
        const j = open[rng.int(open.length)];
        for (const bet of BETS) {
          const now = winChance(m, calls, bet);
          const n = nextOdds(m, calls, j, bet);
          expect(n.pBlue * n.ifBlue + (1 - n.pBlue) * n.ifRed).toBeCloseTo(now, 12);
          // And over a uniformly random next region too (the call order is independent of colours).
          const avg = open.reduce((a, i) => {
            const o = nextOdds(m, calls, i, bet);
            return a + (o.pBlue * o.ifBlue + (1 - o.pBlue) * o.ifRed) / open.length;
          }, 0);
          expect(avg).toBeCloseTo(now, 12);
        }
      }
    }
  });

  it('the shaded part of the paths-to-victory strip is exactly the odds, and decided bets are 0 or 1', () => {
    for (const k of MAP_KEYS) {
      const m = MAPS[k];
      for (let c = 0; c <= m.regions.length; c++) {
        const calls = randomState(m, c);
        const d = finalDist(m, calls);
        const { blue, left } = tally(m, calls);
        for (let t = 0; t <= TOTAL; t++) if (d[t] > 0) expect(t >= blue && t <= blue + left).toBe(true);
        for (const bet of BETS) {
          let shaded = 0;
          for (let t = 0; t <= TOTAL; t++) if (winsAt(t, bet)) shaded += d[t];
          const p = winChance(m, calls, bet);
          expect(p).toBeCloseTo(shaded, 12);
          const dec = decided(m, calls, bet);
          if (dec) expect(p).toBe(dec === 'win' ? 1 : 0);
          else expect(p > 0 && p < 1).toBe(true);
        }
        if (c === m.regions.length) for (const bet of BETS) expect(decided(m, calls, bet)).not.toBeNull();
      }
    }
  });

  it('a total of exactly 50 is a hung map: neither majority wins', () => {
    expect(winsAt(50, { side: 'blue', line: 51 })).toBe(false);
    expect(winsAt(50, { side: 'red', line: 51 })).toBe(false);
    expect(winsAt(51, { side: 'blue', line: 51 })).toBe(true);
    expect(winsAt(49, { side: 'red', line: 51 })).toBe(true);
    expect(winsAt(65, { side: 'blue', line: 65 })).toBe(true);
    expect(winsAt(35, { side: 'red', line: 65 })).toBe(true);
    expect(winsAt(36, { side: 'red', line: 65 })).toBe(false);
  });

  it('switching keeps the cash-out and relocks the prize fairly, within the cap', () => {
    for (let t = 0; t < 300; t++) {
      const k = MAP_KEYS[rng.int(3)];
      const m = MAPS[k];
      const calls = randomState(m, rng.int(m.regions.length));
      const cash = 0.05 + rng.next() * 5;
      const bet = BETS[rng.int(BETS.length)];
      const prize = relock(cash, m, calls, bet);
      if (decided(m, calls, bet)) expect(prize).toBeNull();
      else if (prize === null) expect(cash / winChance(m, calls, bet)).toBeGreaterThan(MAX_WIN);
      else {
        expect(prize * winChance(m, calls, bet)).toBeCloseTo(cash, 12);
        expect(prize).toBeLessThanOrEqual(MAX_WIN);
      }
    }
  });

  it('fresh prizes sit under the cap and the settings span over 25:1 in odds', () => {
    expect(maxStartPrize()).toBeLessThanOrEqual(MAX_WIN);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
    const ps = MAP_KEYS.flatMap((k) => BETS.map((b) => startChance(k, b)));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
