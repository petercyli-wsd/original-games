import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { LAYOUTS, barLength, nextSegments, nextUsableWidth, tailHalfWidth } from './layout';
import manifest from './manifest';
import {
  COUNTS,
  MAX_MULTIPLIER,
  RTP,
  afterDecay,
  atomsIn,
  fullMask,
  halfLife,
  has,
  headline,
  lastChance,
  lastChanceClosedForm,
  maxPayoutFactor,
  nextChance,
  prizeFor,
  ratePerMinute,
  sampleDecay,
  switchPrize,
  without,
} from './math';

const rng = createRng(seededSource(11));

/** Every survivor set that can appear in a k-atom round. */
const allMasks = (k: number) => Array.from({ length: fullMask(k) }, (_, i) => i + 1);

/** Raw process: each atom gets its own exponential lifetime; returns the atom that decays last. */
function lastOfRace(mask: number, wait = 0): number | null {
  let best = -1;
  let who = 0;
  for (const a of atomsIn(mask)) {
    const t = -Math.log(1 - rng.next()) / ratePerMinute(a);
    if (t < wait) return null;
    if (t > best) {
      best = t;
      who = a;
    }
  }
  return who;
}

describe('Half-Life maths', () => {
  it('the subset recursion equals the inclusion–exclusion closed form for every survivor set', () => {
    for (const mask of allMasks(7)) {
      let sum = 0;
      for (const a of atomsIn(mask)) {
        expect(lastChance(mask, a)).toBeCloseTo(lastChanceClosedForm(mask, a), 12);
        sum += lastChance(mask, a);
      }
      expect(sum).toBeCloseTo(1, 12);
    }
    // Hand-checked values: rates 1, 2, 3 → 7/12, 4/15, 3/20.
    expect(headline(3, 1)).toBeCloseTo(7 / 12, 14);
    expect(headline(3, 2)).toBeCloseTo(4 / 15, 14);
    expect(headline(3, 3)).toBeCloseTo(3 / 20, 14);
  });

  it('the closed form matches a direct race of exponential lifetimes (4 SE)', () => {
    for (const k of COUNTS) {
      const n = 12_000;
      const counts = new Array(k + 1).fill(0);
      for (let r = 0; r < n; r++) counts[lastOfRace(fullMask(k))!]++;
      for (let a = 1; a <= k; a++) {
        const p = headline(k, a);
        expect(Math.abs(counts[a] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-9);
      }
    }
  });

  it('memorylessness: given nobody has decayed by time w, the odds are unchanged', () => {
    const k = 5;
    const wait = 6; // minutes; about 30% of races survive it untouched
    const counts = new Array(k + 1).fill(0);
    let kept = 0;
    while (kept < 12_000) {
      const who = lastOfRace(fullMask(k), wait);
      if (who === null) continue;
      counts[who]++;
      kept++;
    }
    for (let a = 1; a <= k; a++) {
      const p = headline(k, a);
      expect(Math.abs(counts[a] / kept - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / kept) + 1e-9);
    }
  });

  it('the sampled next decay picks atom i with chance λᵢ/Σλ and waits Exp(Σλ)', () => {
    const mask = fullMask(6);
    const n = 40_000;
    const counts = new Array(7).fill(0);
    let wait = 0;
    for (let r = 0; r < n; r++) {
      const d = sampleDecay(mask, rng);
      counts[d.atom]++;
      wait += d.dt;
    }
    for (let a = 1; a <= 6; a++) {
      const p = nextChance(mask, a);
      expect(Math.abs(counts[a] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
    const lambda = atomsIn(mask).reduce((s, a) => s + ratePerMinute(a), 0);
    expect(Math.abs(wait / n - 1 / lambda)).toBeLessThan((4 * (1 / lambda)) / Math.sqrt(n));
  });

  it('martingale: at every reachable state E[cash-out after the next decay] = cash-out now', () => {
    for (const k of COUNTS) {
      for (const mask of allMasks(k)) {
        for (const backed of atomsIn(mask)) {
          if (atomsIn(mask).length < 2) continue;
          const prize = 1.7 + rng.next() * 30;
          const now = prize * lastChance(mask, backed);
          let expected = 0;
          for (const i of atomsIn(mask)) expected += nextChance(mask, i) * afterDecay(prize, mask, backed, i).cash;
          expect(Math.abs(expected - now)).toBeLessThan(1e-12 * Math.max(1, now));
        }
      }
    }
  });

  it('switching keeps the cash-out exactly, and switching back restores the prize', () => {
    for (let trial = 0; trial < 200; trial++) {
      const k = COUNTS[rng.int(COUNTS.length)];
      let mask = fullMask(k);
      const decays = rng.int(k - 1);
      for (let d = 0; d < decays; d++) {
        const atoms = atomsIn(mask);
        mask = without(mask, atoms[rng.int(atoms.length)]);
      }
      const atoms = atomsIn(mask);
      const j = atoms[rng.int(atoms.length)];
      const m = atoms[rng.int(atoms.length)];
      const prize = prizeFor(k, Math.min(k, j));
      const cash = prize * lastChance(mask, j);
      const relocked = switchPrize(cash, mask, m);
      expect(relocked * lastChance(mask, m)).toBeCloseTo(cash, 12);
      expect(switchPrize(cash, mask, j)).toBeCloseTo(prize, 10);
    }
  });

  it('the drawn odds are the true odds: bars, next-decay slices, survival tails', () => {
    for (const L of LAYOUTS) {
      for (const k of COUNTS) {
        for (const mask of allMasks(k)) {
          // Bars: length / track = P(last), and the survivors' bars fill exactly one track.
          let total = 0;
          for (const a of atomsIn(mask)) {
            expect(barLength(L, lastChance(mask, a)) / L.barW).toBeCloseTo(lastChance(mask, a), 12);
            total += barLength(L, lastChance(mask, a));
          }
          expect(total).toBeCloseTo(L.barW, 9);
          // Next-decay slices: width / usable width = λᵢ/Σλ, laid edge to edge from the left.
          const segs = nextSegments(L, mask);
          const usable = nextUsableWidth(L, mask);
          expect(segs[0].x).toBe(L.laneX0);
          for (const s of segs) expect(s.w / usable).toBeCloseTo(nextChance(mask, s.atom), 12);
          expect(segs.reduce((s, x) => s + x.w, 0)).toBeCloseTo(usable, 9);
          // Slices stay inside the board.
          const last = segs[segs.length - 1];
          expect(last.x + last.w).toBeLessThanOrEqual(L.textX + 1e-9);
        }
      }
    }
    // Tails halve every half-life, whatever the clock says (memoryless).
    for (let a = 1; a <= 7; a++) {
      for (const s of [0, 1.3, 7, 22]) {
        expect(tailHalfWidth(a, s + halfLife(a), 10)).toBeCloseTo(tailHalfWidth(a, s, 10) / 2, 12);
      }
    }
    // And the drawn next-decay slices match how often each atom really decays next.
    const mask = without(fullMask(7), 3);
    const n = 30_000;
    const counts = new Array(8).fill(0);
    for (let r = 0; r < n; r++) {
      let first = 0;
      let tMin = Infinity;
      for (const a of atomsIn(mask)) {
        const t = -Math.log(1 - rng.next()) / ratePerMinute(a);
        if (t < tMin) {
          tMin = t;
          first = a;
        }
      }
      counts[first]++;
    }
    const usable = nextUsableWidth(LAYOUTS[0], mask);
    for (const s of nextSegments(LAYOUTS[0], mask)) {
      const p = s.w / usable;
      expect(Math.abs(counts[s.atom] / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('a round ends at the right moments', () => {
    const mask = fullMask(3);
    expect(afterDecay(10, mask, 2, 2)).toEqual({
      mask: without(mask, 2),
      cash: 0,
      outcome: 'decayed',
    });
    const one = afterDecay(10, mask, 2, 1);
    expect(one.outcome).toBeNull();
    expect(one.cash).toBeCloseTo(10 * lastChance(without(mask, 1), 2), 12);
    const win = afterDecay(10, one.mask, 2, 3);
    expect(win).toEqual({ mask: 0b010, cash: 10, outcome: 'last' });
    expect(has(win.mask, 2)).toBe(true);
  });

  it('maxMultiplier is an honest bound: switching never beats backing the fastest atom', () => {
    for (const k of COUNTS) {
      const p = atomsIn(fullMask(k)).map((a) => headline(k, a));
      expect(maxPayoutFactor(fullMask(k))).toBeCloseTo(1 / Math.min(...p), 9);
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / headline(7, 7), 9);
    // The headline odds span at least 25:1 across the settings.
    expect(headline(3, 1) / headline(7, 7)).toBeGreaterThan(25);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });
});
