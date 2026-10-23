import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BEAD_COUNTS,
  MAX_PRIZE,
  RTP,
  addBead,
  allowed,
  autoRound,
  beadFrom,
  chance,
  chanceAt,
  diffOf,
  effect,
  finalLaw,
  forecast,
  kMax,
  law,
  openChance,
  prizeFor,
  settled,
  totalOf,
  wins,
  type Bet,
  type Pans,
} from './math';

const rng = createRng(seededSource(11));

const BETS = (n: number): Bet[] => [
  { kind: 'L', k: 0 },
  { kind: 'R', k: 0 },
  { kind: 'B', k: 0 },
  { kind: 'K', k: 2 },
  { kind: 'K', k: 12 },
  { kind: 'K', k: kMax(n) },
];

/** Random reachable mid-round states. */
function states(n: number, count: number): Pans[] {
  const out: Pans[] = [];
  for (let i = 0; i < count; i++) {
    let s: Pans = { n, beads: [] };
    const stop = rng.int(n);
    while (s.beads.length < stop) s = addBead(s, beadFrom(rng.next()));
    out.push(s);
  }
  return out;
}

/** Brute force: the law of S_m by enumerating all 12^m bead sequences. */
function bruteLaw(m: number): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (k: number, sum: number, p: number) => {
    if (k === m) return void out.set(sum, (out.get(sum) ?? 0) + p);
    for (let i = 0; i < 12; i++) walk(k + 1, sum + effect(beadFrom((i + 0.5) / 12)), p / 12);
  };
  walk(0, 0, 1);
  return out;
}

describe('Scales maths', () => {
  it('the bead law is uniform over the 12 (side, weight) pairs', () => {
    const seen = new Map<string, number>();
    const N = 12_000;
    for (let i = 0; i < N; i++) {
      const b = beadFrom((i + 0.5) / N);
      seen.set(b.side + b.w, (seen.get(b.side + b.w) ?? 0) + 1);
    }
    expect(seen.size).toBe(12);
    for (const c of seen.values()) expect(c).toBe(N / 12);
  });

  it('the convolution DP equals brute-force enumeration of every bead sequence', () => {
    for (let m = 0; m <= 4; m++) {
      const f = law(m);
      const b = bruteLaw(m);
      let total = 0;
      for (let i = 0; i < f.length; i++) {
        expect(f[i]).toBeCloseTo(b.get(i - 6 * m) ?? 0, 14);
        total += f[i];
      }
      expect(total).toBeCloseTo(1, 12);
    }
    // The law of S_20 has the right mean and variance (E[X²] = 91/6 per bead).
    const f = law(20);
    let mean = 0;
    let sq = 0;
    for (let i = 0; i < f.length; i++) {
      mean += f[i] * (i - 120);
      sq += f[i] * (i - 120) ** 2;
    }
    expect(mean).toBeCloseTo(0, 10);
    expect(sq).toBeCloseTo((20 * 91) / 6, 8);
  });

  it('the exact chances match a direct simulation of the raw drops', () => {
    for (const n of [8, 16]) {
      for (const bet of BETS(n).slice(0, 5)) {
        const rounds = 20_000;
        let hits = 0;
        for (let r = 0; r < rounds; r++) {
          let D = 0;
          for (let i = 0; i < n; i++) D += rng.next() < 0.5 ? 1 + rng.int(6) : -(1 + rng.int(6));
          if (wins(bet, D)) hits++;
        }
        const p = openChance(n, bet);
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('every drop is a fair bet: the 12 forecast chances average to the chance now (martingale)', () => {
    for (const n of BEAD_COUNTS) {
      for (const s of states(n, 25)) {
        for (const bet of BETS(n)) {
          if (settled(s, bet)) continue;
          const f = forecast(s, bet);
          const avg = [...f.L, ...f.R].reduce((a, b) => a + b, 0) / 12;
          expect(avg).toBeCloseTo(chanceAt(s, bet), 12);
          // The forecast cell for a bead is exactly the chance after that bead lands.
          const b = beadFrom(rng.next());
          const after = chanceAt(addBead(s, b), bet);
          expect(after).toBeCloseTo((b.side === 'L' ? f.L : f.R)[b.w - 1], 14);
        }
      }
    }
  });

  it('the shaded strip is the odds: the winning mass of the drawn law equals the chance', () => {
    for (const n of BEAD_COUNTS) {
      for (const s of states(n, 20)) {
        const D = diffOf(s);
        const m = n - s.beads.length;
        const pts = finalLaw(D, m);
        expect(pts.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 12);
        for (const bet of BETS(n)) {
          const shaded = pts.filter((x) => wins(bet, x.d)).reduce((a, x) => a + x.p, 0);
          expect(shaded).toBeCloseTo(chance(bet, D, m), 12);
        }
        // The tilt is the lead: D is left total − right total.
        expect(D).toBe(totalOf(s, 'L') - totalOf(s, 'R'));
      }
    }
  });

  it('a bet settles exactly when its result can no longer change', () => {
    for (const n of [8, 12]) {
      for (const s of states(n, 60)) {
        const D = diffOf(s);
        const m = n - s.beads.length;
        const lo = D - 6 * m;
        const hi = D + 6 * m;
        for (const bet of BETS(n)) {
          // Reachable finals: every value in [lo, hi], except D itself when one bead is left.
          let anyWin = false;
          let anyLose = false;
          for (let d = lo; d <= hi; d++) {
            if (m === 1 && d === D) continue;
            if (wins(bet, d)) anyWin = true;
            else anyLose = true;
          }
          const r = settled(s, bet);
          expect(r).toBe(anyWin && anyLose ? null : anyWin ? 'win' : 'lose');
        }
      }
    }
    // A full board is always settled.
    let s: Pans = { n: 8, beads: [] };
    while (s.beads.length < 8) s = addBead(s, beadFrom(rng.next()));
    for (const bet of BETS(8)) expect(settled(s, bet)).not.toBeNull();
  });

  it('every offered prize is within the cap, and the margin range is the largest that fits', () => {
    for (const n of BEAD_COUNTS) {
      const k = kMax(n);
      expect(prizeFor(n, { kind: 'K', k })).toBeLessThanOrEqual(MAX_PRIZE);
      expect(prizeFor(n, { kind: 'K', k: k + 1 })).toBeGreaterThan(MAX_PRIZE);
      for (const bet of BETS(n)) {
        expect(allowed(n, bet)).toBe(true);
        expect(prizeFor(n, bet)).toBeLessThanOrEqual(manifest.maxMultiplier);
      }
      // Left and Right are mirror images.
      expect(openChance(n, { kind: 'L', k: 0 })).toBeCloseTo(openChance(n, { kind: 'R', k: 0 }), 12);
    }
  });

  it('Auto rounds return RTP under every cash-out target', () => {
    for (const cashAt of [null, 2] as const) {
      const bet: Bet = { kind: 'B', k: 0 };
      const rounds = 20_000;
      let sum = 0;
      let sq = 0;
      for (let r = 0; r < rounds; r++) {
        const m = autoRound(12, bet, cashAt, () => rng.next()).multiplier;
        sum += m;
        sq += m * m;
      }
      const mean = sum / rounds;
      const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
