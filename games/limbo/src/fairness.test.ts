// Fairness audit: can any way of playing Limbo beat the RTP?
//
// A Limbo round has no mid-round decision: the target is fixed when Bet is
// pressed (setTarget refuses while rolling or while Auto runs), play() draws
// the result at once from two rng.next() calls, and the counter animation
// only shows it; there is no cash-out, and leaving mid-climb settles the
// ticket at the drawn result. So the tester's rule (a) and take-any-profit (b)
// collapse to (c), "play the round". What a player can choose is the target
// and the stake of each round, from what they have seen so far. Rounds are
// independent, so that is fair iff every single target is worth ≤ RTP.
//
// Checked here, with the game's own functions:
//   - martingale (one event, exactly): for 40+ targets the win set is
//     k ≤ floor(99N/T) on the lattice, read off decide() at its boundary, so
//     E[payout] = (T/100)·floor(99N/T)/N ∈ [0.99 − T/(100N), 0.99];
//   - every target in whole cents from 1.01× to 1,000× (and a log sweep to
//     1,000,000×) is worth ≤ 99% exactly, so even a player who knew the best
//     target could not beat 99%;
//   - drawK is a bijection from two 32-bit draws onto {1, …, 2^52}, so U = k/N
//     is uniform on the lattice;
//   - Monte Carlo per eval band: (c) the eval's own log-uniform targets, the
//     band's two ends, and (d) progression systems (Martingale doubling at 2×,
//     a "chase" that raises the target after each loss, Paroli) measured as
//     payout ÷ total staked.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_TARGET, MIN_TARGET, N, PRESETS, RTP, clampTarget, decide, drawK, exactRtp, play, targetCents } from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;

/** The win boundary read off the implementation: the largest k that wins (binary search on decide()). */
function boundary(t: number): number {
  let lo = 1; // wins (result is capped at 1,000,000× ≥ any target)
  let hi = N; // loses (result 0.99 / 1 < 1.01)
  expect(decide(lo, t).win).toBe(true);
  expect(decide(hi, t).win).toBe(false);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (decide(mid, t).win) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The win boundary from decide() at the predicted k and its neighbour (checks the implementation, not the formula). */
function boundaryFast(t: number): number {
  const k = Number((99n * BigInt(N)) / BigInt(targetCents(t)));
  if (!decide(k, t).win || (k < N && decide(k + 1, t).win)) throw new Error(`boundary off at ${t}`);
  return k;
}

/** Monte Carlo of payout ÷ stake for a sequence of bets with predictable stakes; SE by the martingale-difference formula. */
function mcRatio(next: (rng: Rng) => { stake: number; mult: number }, bets: number, seed: number, adaptive = false, maxBets = 40_000_000) {
  const rng = createRng(seededSource(seed));
  let staked = 0;
  let paid = 0;
  let v = 0;
  let n = 0;
  let max = 0;
  const stat = () => ({ mean: paid / staked, se: Math.sqrt(v) / staked, n, max });
  for (;;) {
    const goal = n + (n < bets ? bets - n : 100_000);
    for (; n < goal; n++) {
      const { stake, mult } = next(rng);
      staked += stake;
      paid += stake * mult;
      v += stake * stake * (mult - RTP) ** 2;
      if (mult > max) max = mult;
    }
    if (!adaptive || stat().se <= 0.003 || n >= maxBets) return stat();
  }
}

describe('Limbo fairness', () => {
  it('martingale (exact): at 40+ targets, E[payout] from decide()’s own win boundary is 99% to within T/(100N), never above', () => {
    const rng = createRng(seededSource(61));
    const targets = [MIN_TARGET, 1.02, 1.5, 1.98, 1.99, 2, 2.01, 3.33, 9.99, 10, 99.99, 100, 1000, 12_345.67, 999_999.99, MAX_TARGET, ...PRESETS];
    while (targets.length < 45) targets.push(clampTarget(Math.exp(rng.next() * Math.log(MAX_TARGET))));
    for (const t of targets) {
      const T = targetCents(t);
      const k = boundary(t);
      expect(k).toBe(Number((99n * BigInt(N)) / BigInt(T)));
      // In integers: E[payout] = T·k / (100N) ≤ 99N / (100N) = 0.99, short by T·k vs 99N − T < 99N.
      const TK = BigInt(T) * BigInt(k);
      const A = 99n * BigInt(N);
      expect(TK <= A).toBe(true);
      expect(A - TK < BigInt(T)).toBe(true);
      expect(Math.abs((T / 100) * (k / N) - exactRtp(t))).toBeLessThan(1e-15);
      // The payout on a win is the target itself, never more.
      expect(decide(k, t).multiplier).toBe(T / 100);
    }
  });

  it('no target is worth more than 99%: every whole-cent target 1.01×–1,000× and a log sweep to 1,000,000×', () => {
    // Exactly, in integers: T·floor(99N/T) ≤ 99N for the T the game actually pays (targetCents of the clamped target).
    const A = 99n * BigInt(N);
    let over = 0;
    let worst = 0n;
    const check = (t: number) => {
      const T = BigInt(targetCents(t));
      const k = BigInt(boundaryFast(t));
      if (T * k > A) over++;
      if (A - T * k > worst) worst = A - T * k;
    };
    for (let T = 101; T <= 100_000; T++) check(T / 100);
    for (let i = 0; i <= 20_000; i++) check(clampTarget(1000 * 1000 ** (i / 20_000)));
    expect(over).toBe(0);
    // Never more than one target's worth (T ≤ 10^8) short of 99N: under 2.3e-10 of RTP.
    expect(worst < 100_000_000n).toBe(true);
  });

  it('drawK maps two 32-bit draws one-to-one onto {1, …, 2^52}', () => {
    const script = (vals: number[]) => {
      let i = 0;
      return () => vals[i++];
    };
    expect(drawK(script([0, 0]))).toBe(1);
    expect(drawK(script([1 - 2 ** -32, 1 - 2 ** -32]))).toBe(N);
    // Low draw: each of the 2^20 low values comes from exactly 2^12 of the 2^32 source values.
    const rng = createRng(seededSource(62));
    for (let t = 0; t < 2000; t++) {
      const hi = Math.floor(rng.next() * 2 ** 32);
      const lo20 = Math.floor(rng.next() * 2 ** 20);
      const k = drawK(script([hi / 2 ** 32, (lo20 * 2 ** 12 + Math.floor(rng.next() * 2 ** 12)) / 2 ** 32]));
      expect(k).toBe(hi * 2 ** 20 + lo20 + 1);
    }
  });

  it('strategies per eval band: the eval’s targets, the band ends, and progression systems return RTP within 4 SE', () => {
    const rows: string[] = [];
    const rounds = FULL ? 200_000 : 20_000;
    evalSpec.configs.forEach(({ label, params: { lo, hi } }, ci) => {
      const logUniform = (rng: Rng) => clampTarget(lo * Math.exp(Math.log(hi / lo) * rng.next()));
      const strategies: { name: string; make: () => (rng: Rng) => { stake: number; mult: number } }[] = [
        // (a) and (b) collapse to (c): the round is one draw with nothing to decide.
        { name: '(c) eval targets (log-uniform)', make: () => (rng) => ({ stake: 1, mult: play(rng.next, logUniform(rng)).multiplier }) },
        { name: '(c) band low end', make: () => (rng) => ({ stake: 1, mult: play(rng.next, clampTarget(lo)).multiplier }) },
        { name: '(c) band high end', make: () => (rng) => ({ stake: 1, mult: play(rng.next, clampTarget(hi)).multiplier }) },
        {
          name: '(d) Martingale ×2 on loss (≤ 10)',
          make: () => {
            let stake = 1;
            const t = clampTarget(Math.max(lo, Math.min(hi, 2)));
            return (rng) => {
              const s = stake;
              const mult = play(rng.next, t).multiplier;
              stake = mult > 0 || stake >= 2 ** 10 ? 1 : stake * 2;
              return { stake: s, mult };
            };
          },
        },
        {
          name: '(d) chase: target ×1.5 per loss',
          make: () => {
            let t = clampTarget(lo);
            return (rng) => {
              const mult = play(rng.next, t).multiplier;
              t = mult > 0 || t * 1.5 > hi ? clampTarget(lo) : clampTarget(t * 1.5);
              return { stake: 1, mult };
            };
          },
        },
        {
          name: '(d) Paroli: let 3 wins ride',
          make: () => {
            let stake = 1;
            let streak = 0;
            return (rng) => {
              const s = stake;
              const t = logUniform(rng);
              const mult = play(rng.next, t).multiplier;
              if (mult > 0 && streak < 2) {
                stake = s * mult;
                streak++;
              } else {
                stake = 1;
                streak = 0;
              }
              return { stake: s, mult };
            };
          },
        },
      ];
      strategies.forEach(({ name, make }, si) => {
        const { mean, se, n, max } = mcRatio(make(), rounds, 9100 + 17 * ci + si, FULL);
        rows.push(`${label.padEnd(24)} ${name.padEnd(34)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  n ${n}  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(MAX_TARGET);
      });
    });
    if (FULL) console.log(rows.join('\n'));
  });
});
