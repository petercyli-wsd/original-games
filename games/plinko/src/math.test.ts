import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { bucketX, layoutFor, pegX, pegs, waypoints } from './geometry';
import manifest from './manifest';
import { MAX_MULTIPLIER, RISKS, ROWS, RTP, baseTable, binom, dropBall, plateauFraction, resolveDrop, tableFor } from './math';

const bigBinom = (n: number, k: number) => {
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
};

describe('Plinko paytables', () => {
  it('every (rows, risk) table returns exactly 99%, checked in integer arithmetic', () => {
    const lines: string[] = [];
    for (const risk of RISKS) {
      for (const n of ROWS) {
        const t = tableFor(n, risk);
        const base = baseTable(n, risk);
        const { num, den } = plateauFraction(n, risk);
        // Σ C(n,k)·mₖ = 0.99·2ⁿ  ⇔  Σ_{k∉P} C·(100mₖ)·den + Σ_{k∈P} C·100·num = 99·2ⁿ·den
        let lhs = 0n;
        for (let k = 0; k <= n; k++) {
          const c = bigBinom(n, k);
          lhs += t.plateau.includes(k) ? c * 100n * BigInt(num) : c * BigInt(Math.round(base[k] * 100)) * BigInt(den);
        }
        expect(lhs).toBe(99n * 2n ** BigInt(n) * BigInt(den));
        expect(t.rtp).toBeCloseTo(RTP, 13);
        const plateauValue = t.mults[t.plateau[0]];
        lines.push(
          `${risk.padEnd(6)} ${String(n).padStart(2)} rows  RTP = ${(t.rtp * 100).toFixed(10)}%  plateau ${t.plateauBase}→${plateauValue.toFixed(6)} (= ${num}/${den})  sd ${t.stdDev.toFixed(3)}`,
        );
      }
    }
    console.log(lines.join('\n'));
  });

  it('normalisation is minimal: only the centre plateau moves, by under 0.004×, edges stay round', () => {
    for (const risk of RISKS) {
      for (const n of ROWS) {
        const t = tableFor(n, risk);
        const base = baseTable(n, risk);
        for (let k = 0; k <= n; k++) {
          if (t.plateau.includes(k)) expect(Math.abs(t.mults[k] - base[k])).toBeLessThan(0.004);
          else expect(t.mults[k]).toBe(base[k]);
        }
        expect(t.plateau).not.toContain(0);
        expect(Number.isInteger(t.mults[0] * 10)).toBe(true);
      }
    }
  });

  it('tables are symmetric, fall monotonically from the edge to the centre, and stay positive', () => {
    for (const risk of RISKS) {
      for (const n of ROWS) {
        const m = tableFor(n, risk).mults;
        expect(m).toHaveLength(n + 1);
        for (let k = 0; k <= n; k++) expect(m[k]).toBe(m[n - k]);
        for (let k = 1; k <= n / 2; k++) expect(m[k]).toBeLessThanOrEqual(m[k - 1]);
        expect(Math.min(...m)).toBeGreaterThan(0);
      }
    }
  });

  it('higher risk means a bigger top prize and more volatility at every row count', () => {
    for (const n of ROWS) {
      const [l, m, h] = RISKS.map((r) => tableFor(n, r));
      expect(l.max).toBeLessThan(m.max);
      expect(m.max).toBeLessThan(h.max);
      expect(l.stdDev).toBeLessThan(m.stdDev);
      expect(m.stdDev).toBeLessThan(h.stdDev);
    }
  });

  it('the max multiplier is honest', () => {
    expect(MAX_MULTIPLIER).toBe(1000);
    expect(tableFor(16, 'high').mults[0]).toBe(1000);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });
});

describe('Plinko drops', () => {
  it('the bucket is Binomial(n, ½): simulated frequencies match C(n,k)/2ⁿ within 4 SE', () => {
    const rng = createRng(seededSource(11));
    for (const n of [8, 12, 16]) {
      const N = 200_000;
      const counts = new Array(n + 1).fill(0);
      for (let i = 0; i < N; i++) counts[dropBall(() => rng.next(), n).bucket]++;
      const probs = tableFor(n, 'medium').probs;
      let total = 0;
      for (let k = 0; k <= n; k++) {
        expect(probs[k]).toBe(binom(n, k) / 2 ** n);
        total += probs[k];
        const se = Math.sqrt((probs[k] * (1 - probs[k])) / N);
        expect(Math.abs(counts[k] / N - probs[k])).toBeLessThan(4 * se + 1e-9);
      }
      expect(total).toBeCloseTo(1, 14);
    }
  });

  it('simulated RTP of single tables matches 99% within 4 SE', () => {
    const rng = createRng(seededSource(5));
    for (const [n, risk] of [
      [8, 'low'],
      [12, 'medium'],
      [16, 'high'],
    ] as const) {
      const N = 200_000;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < N; i++) {
        const m = resolveDrop(() => rng.next(), n, risk).multiplier;
        sum += m;
        sq += m * m;
      }
      const mean = sum / N;
      const se = Math.sqrt((sq / N - mean * mean) / N);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    }
  });

  it('one drop (one auto bet) uses exactly `rows` draws and resolves once to its table value', () => {
    for (const n of ROWS) {
      let draws = 0;
      const rng = createRng(seededSource(n));
      const r = resolveDrop(
        () => {
          draws++;
          return rng.next();
        },
        n,
        'high',
      );
      expect(draws).toBe(n);
      expect(r.path).toHaveLength(n);
      expect(r.bucket).toBe(r.path.filter(Boolean).length);
      expect(r.multiplier).toBe(tableFor(n, 'high').mults[r.bucket]);
    }
  });

  it('the drawn ball path touches a real peg in every row and ends over the paid bucket', () => {
    const rng = createRng(seededSource(9));
    for (const n of ROWS) {
      const l = layoutFor(n);
      const pegSet = new Set(pegs(l).map((p) => `${p.row}:${p.j}`));
      for (let i = 0; i < 200; i++) {
        const { path, bucket } = dropBall(() => rng.next(), n);
        const pts = waypoints(l, path);
        expect(pts).toHaveLength(n + 2);
        for (let r = 0; r < n; r++) {
          const p = pts[r + 1];
          expect(pegSet.has(`${p.peg!.row}:${p.peg!.j}`)).toBe(true);
          expect(p.x).toBeCloseTo(pegX(l, r, p.peg!.j), 9);
        }
        expect(pts[n + 1].x).toBeCloseTo(bucketX(l, bucket), 9);
        // Bucket k sits between pegs k and k+1 of the last row.
        expect(bucketX(l, bucket)).toBeCloseTo((pegX(l, n - 1, bucket) + pegX(l, n - 1, bucket + 1)) / 2, 9);
      }
    }
  });
});

describe('Plinko eval', () => {
  it('simulated RTP matches the manifest and stays within the max multiplier', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[reports.length - 1].stdDev / reports[0].stdDev).toBeGreaterThan(5);
  });
});
