import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  ALL_SETTINGS,
  BETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  blockers,
  cashOut,
  chanceOf,
  coprimeRows,
  deadColumns,
  factorLabel,
  litCount,
  litRows,
  liveChance,
  nextStep,
  prizeOf,
  reveal,
  stepRisk,
  targetChance,
  visible,
  visibleCount,
  winChance,
  wins,
  type Settings,
  type Target,
} from './math';

const rng = createRng(seededSource(11));

/** The lattice points strictly inside the segment from the origin to (a, b), found by scanning x. */
function onSegment(a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 1; x < a; x++) if ((b * x) % a === 0) out.push([x, (b * x) / a]);
  return out;
}

/** The raw process: does a target at (a, b) win, judged by the geometry alone (no gcd)? */
const geomWins = (bet: Settings['bet'], a: number, b: number) => {
  const inTheWay = onSegment(a, b).length;
  return bet === 'sight' ? inTheWay === 0 : bet === 'shadow' ? inTheWay >= 1 : inTheWay >= 2;
};

function bruteGcd(a: number, b: number) {
  let g = 1;
  for (let d = 2; d <= Math.min(a, b); d++) if (a % d === 0 && b % d === 0) g = d;
  return g;
}

describe('Line of Sight maths', () => {
  it('visible lattice points: the Möbius count equals 2·Σφ − 1 and the brute-force count, and tends to 6/π²', () => {
    let phiSum = 0;
    for (let N = 1; N <= 60; N++) {
      let phi = 0;
      for (let k = 1; k <= N; k++) if (bruteGcd(k, N) === 1) phi++;
      phiSum += phi;
      let brute = 0;
      for (let a = 1; a <= N; a++) for (let b = 1; b <= N; b++) if (bruteGcd(a, b) === 1) brute++;
      expect(visibleCount(N)).toBe(brute);
      expect(visibleCount(N)).toBe(2 * phiSum - 1);
    }
    expect(visibleCount(10)).toBe(63);
    expect(visibleCount(20)).toBe(255);
    expect(visibleCount(50)).toBe(1547);
    const N = 3000;
    expect(Math.abs(visibleCount(N) / N ** 2 - 6 / Math.PI ** 2)).toBeLessThan(1e-3);
  });

  it('a tree is hidden exactly when another lattice point is on the line of sight, and those are the drawn blockers', () => {
    for (let a = 1; a <= 50; a++) {
      for (let b = 1; b <= 50; b++) {
        const seg = onSegment(a, b);
        expect(blockers(a, b)).toEqual(seg);
        expect(visible(a, b)).toBe(seg.length === 0);
        expect(seg.length).toBe(bruteGcd(a, b) - 1);
        for (const bet of BETS) expect(wins(bet, a, b)).toBe(geomWins(bet, a, b));
      }
    }
  });

  it('exactly V(⌊N/g⌋) trees have gcd g, so Deep shadow holds N² − V(N) − V(⌊N/2⌋) trees (→ 1 − 1.25·6/π²)', () => {
    for (let N = 1; N <= 60; N++) {
      const byGcd = new Map<number, number>();
      for (let a = 1; a <= N; a++) for (let b = 1; b <= N; b++) byGcd.set(bruteGcd(a, b), (byGcd.get(bruteGcd(a, b)) ?? 0) + 1);
      for (let g = 1; g <= N; g++) expect(byGcd.get(g) ?? 0).toBe(visibleCount(Math.floor(N / g)));
      expect(litCount('deep', N)).toBe(N * N - (byGcd.get(1) ?? 0) - (byGcd.get(2) ?? 0));
    }
    const N = 3000;
    expect(Math.abs(litCount('deep', N) / N ** 2 - (1 - 1.25 * (6 / Math.PI ** 2)))).toBeLessThan(1e-3);
  });

  it('the lit dots drawn in a column are Legendre’s count, and the columns add up to the lit orchard', () => {
    for (const bet of BETS) {
      for (const N of SIZES) {
        let total = 0;
        let dead = 0;
        for (let a = 1; a <= N; a++) {
          let lit = 0;
          for (let b = 1; b <= N; b++) if (wins(bet, a, b)) lit++;
          expect(litRows(bet, a, N)).toBe(lit);
          if (bet === 'sight') expect(coprimeRows(a, N)).toBe(lit);
          const s: Settings = { bet, size: N, count: 2 };
          // The chance bar and the "x / N lit" label show lit/N; the bust chance of the row reveal is the unlit share.
          expect(chanceOf(s, { a, b: null })).toBe(lit / N);
          expect(stepRisk(s, [{ a, b: null }])).toBeCloseTo((N - lit) / N, 15);
          total += lit;
          if (lit === 0) dead++;
        }
        expect(total).toBe(litCount(bet, N));
        expect(dead).toBe(deadColumns(bet, N));
        expect(dead).toBe({ sight: 0, shadow: 1, deep: 2 }[bet]);
        // The lit share of the whole orchard is the per-target chance shown before a column is revealed.
        expect(targetChance(bet, N)).toBe(total / N ** 2);
      }
    }
  });

  it('k random targets all win as often as the closed form p^k says (raw geometry, 4 SE)', () => {
    for (const s of ALL_SETTINGS) {
      const rounds = 12_000;
      let won = 0;
      for (let r = 0; r < rounds; r++) {
        let ok = true;
        for (let i = 0; ok && i < s.count; i++) ok = geomWins(s.bet, 1 + rng.int(s.size), 1 + rng.int(s.size));
        if (ok) won++;
      }
      const p = winChance(s);
      expect(Math.abs(won / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 2e-4);
    }
  });

  it('each reveal is a fair bet: E[cash-out after the next reveal] = cash-out now', () => {
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const s = ALL_SETTINGS[rng.int(ALL_SETTINGS.length)];
      let targets: Target[] = [];
      const depth = rng.int(2 * s.count);
      for (let i = 0; i < depth; i++) {
        const next = reveal(s, targets, 1 + rng.int(s.size));
        if (liveChance(s, next) === 0) break;
        targets = next;
      }
      if (!nextStep(s, targets)) continue;
      const now = cashOut(s, targets);
      let mean = 0;
      for (let v = 1; v <= s.size; v++) mean += cashOut(s, reveal(s, targets, v)) / s.size;
      expect(Math.abs(mean - now)).toBeLessThan(1e-9 * Math.max(1, now));
      // The value never exceeds the prize, and the prize never exceeds maxMultiplier.
      expect(now).toBeLessThanOrEqual(prizeOf(s) * (1 + 1e-12));
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('the round starts at RTP, a full win pays the prize, and maxMultiplier is the largest prize', () => {
    for (const s of ALL_SETTINGS) {
      expect(cashOut(s, [])).toBeCloseTo(RTP, 12);
      expect(prizeOf(s)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / (145 / 400) ** 8, 6);
    // A full win: every target lit, cash-out = prize exactly.
    const s: Settings = { bet: 'sight', size: 10, count: 2 };
    expect(cashOut(s, [{ a: 3, b: 4 }, { a: 1, b: 9 }])).toBe(prizeOf(s));
    expect(cashOut(s, [{ a: 3, b: 4 }, { a: 2, b: 4 }])).toBe(0);
    // Column 1 is all in sight, so In shadow loses there before its row is drawn.
    expect(liveChance({ bet: 'shadow', size: 20, count: 1 }, [{ a: 1, b: null }])).toBe(0);
    // Deep shadow: columns 1 and 2 hold no tree with gcd ≥ 3; column 12 lights rows 3, 4, 6, 8, 9, 12, … (gcd ≥ 3).
    expect(liveChance({ bet: 'deep', size: 20, count: 1 }, [{ a: 2, b: null }])).toBe(0);
    expect(litRows('deep', 12, 20)).toBe([3, 4, 6, 8, 9, 12, 15, 16, 18, 20].length);
    expect(Math.max(...ALL_SETTINGS.filter((x) => x.bet === 'deep').map((x) => x.count))).toBe(3);
    expect(factorLabel(12)).toBe('12 = 2²·3');
    expect(factorLabel(7)).toBe('7 is prime');
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
