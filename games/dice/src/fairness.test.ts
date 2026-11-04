// Fairness audit: can any way of playing Dice beat the RTP?
//
// A round is one roll with no decision after the bet: the target, direction
// and stake are fixed when Bet is pressed (every control is disabled while
// rolling) and the roll is drawn once. So the tester's rule (a) and "take any
// profit" (b) collapse to (c) "play the round": there is no mid-round
// cash-out to time. What a player *can* choose is the target, the direction,
// the input path (slider, multiplier box, chance box) and the stake sequence
// across rounds (auto-bet's on-win / on-loss rules).
//
// The binding check is exact, not sampled. The host RNG (`cryptoSource`)
// returns j / 2^32 for a uniform 32-bit j, so every target's true win chance
// is (number of winning j) / 2^32. `roll()` is monotone in j, so a binary
// search over j with the real `roll()` finds that count exactly. Every chance
// the UI can produce (0.01 … 98.00 in steps of 0.01, both directions) is
// priced at RTP / chance; the exact return of each must be RTP to within the
// 2^-32 grid. This also settles the `<` vs `>` tie rule at the target.
//
// Strategies, Monte Carlo on the real `roll()` with the seeded RNG:
//   (c) every eval config, one roll per round;
//   (d1) always pick the target whose 32-bit rounding favours the player most
//        (found by the exact scan);
//   (d2) a martingale stake progression at 49.5% (double after a loss, reset
//        after a win, auto-bet's rounding to cents), measured as returned ÷
//        staked: stake changes cannot move a per-bet RTP.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_CHANCE, MAX_MULTIPLIER, MIN_CHANCE, RTP, chanceForMultiplier, chanceOf, clampChance, multiplierFor, roll, targetFor, type Direction } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 50_000);
const GRID = 2 ** 32;

/** Exact number of 32-bit draws j (u = j / 2^32) that win, using the real roll(). */
function winningDraws(target: number, dir: Direction): number {
  const wins = (j: number) => roll(j / GRID, target, dir).win;
  // over: wins for j ≥ first winner; under: wins for j < first loser. Both monotone.
  let lo = 0;
  let hi = GRID; // answer in [lo, hi]
  const flips = dir === 'over' ? wins : (j: number) => !wins(j);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (flips(mid)) hi = mid;
    else lo = mid + 1;
  }
  return dir === 'over' ? GRID - lo : lo;
}

/** Every chance the panel can hold: clampChance keeps 2 decimals in [MIN_CHANCE, MAX_CHANCE]. */
const ALL_CHANCES = Array.from({ length: Math.round((MAX_CHANCE - MIN_CHANCE) * 100) + 1 }, (_, i) => clampChance(MIN_CHANCE + i / 100));

const CHANCE_SET = new Set(ALL_CHANCES);

/** RTP = Σ paid / Σ staked, with the ratio estimator's standard error. */
function mc(play: (rng: Rng) => { paid: number; staked: number }, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let p = 0;
  let p2 = 0;
  let s = 0;
  let s2 = 0;
  let ps = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const { paid, staked } = play(rng);
    p += paid;
    p2 += paid * paid;
    s += staked;
    s2 += staked * staked;
    ps += paid * staked;
    if (paid / staked > max) max = paid / staked;
  }
  const rtp = p / s;
  const n = rounds;
  // Var(paid − rtp·staked) per round, over the mean stake.
  const v = p2 / n - (p / n) ** 2 + rtp * rtp * (s2 / n - (s / n) ** 2) - 2 * rtp * (ps / n - (p / n) * (s / n));
  return { rtp, se: Math.sqrt(Math.max(0, v) / n) / (s / n), max };
}

/** Exact return of one chance and direction on the 32-bit grid. */
const exactRtp = (c: number, dir: Direction) => (winningDraws(targetFor(c, dir), dir) / GRID) * multiplierFor(c);

describe('Dice fairness', () => {
  it('exact: every chance on offer, both directions, returns RTP on the 32-bit RNG grid (and never pays above it by more than one grid step)', () => {
    let worst = 0;
    let best = { rtp: 0, chance: 0, dir: 'over' as Direction };
    for (const dir of ['over', 'under'] as const) {
      for (const c of ALL_CHANCES) {
        const target = targetFor(c, dir);
        // The roll's true chance is the target's, and the payout is priced from the chance shown.
        expect(Math.abs(chanceOf(target, dir) - c)).toBeLessThan(1e-9);
        const p = winningDraws(target, dir) / GRID;
        const rtp = exactRtp(c, dir);
        worst = Math.max(worst, Math.abs(rtp - RTP));
        if (rtp > best.rtp) best = { rtp, chance: c, dir };
        // Within one draw of 2^32 at the chance (rounding of the grid only).
        expect(Math.abs(p - c / 100)).toBeLessThanOrEqual(1 / GRID + 1e-15);
      }
    }
    // The grid error is at most 1 / (2^32 · 0.0001) relative: < 2.4e-6 of RTP at the 0.01% extreme.
    expect(worst).toBeLessThan(2.5e-6);
    expect(best.rtp - RTP).toBeLessThan(2.5e-6);
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(`max |RTP − 0.99| = ${worst.toExponential(2)}; best pick ${best.dir} ${best.chance}% → ${best.rtp}`);
  });

  it('every input path lands on a priced chance: slider targets, typed multipliers and typed chances', () => {
    for (const dir of ['over', 'under'] as const) {
      // The slider: Game.tsx's setFromTarget = clampChance(chanceOf(t, dir)).
      for (let i = 0; i <= 10_000; i++) {
        const c = clampChance(chanceOf(i / 100, dir));
        expect(CHANCE_SET.has(c)).toBe(true);
        expect(Math.abs(chanceOf(targetFor(c, dir), dir) - c)).toBeLessThan(1e-9);
      }
    }
    // Typed multipliers and chances go through clampChance too; the payout is always RTP / chance.
    for (const m of [1.0001, 1.0102, 1.5, 2, 3.3333, 99, 1234.5, 9900, 1e9]) {
      const c = chanceForMultiplier(m);
      expect(CHANCE_SET.has(c)).toBe(true);
      expect(multiplierFor(c) * (c / 100)).toBeCloseTo(RTP, 12);
    }
    for (const typed of [-5, 0.001, 0.005, 0.015, 33.333, 98.004, 99.5, 150]) {
      const c = clampChance(typed);
      expect(c).toBeGreaterThanOrEqual(MIN_CHANCE);
      expect(c).toBeLessThanOrEqual(MAX_CHANCE);
      expect(CHANCE_SET.has(c)).toBe(true);
    }
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('strategies: (c) each eval config, (d1) the most favourable rounding, (d2) martingale staking: RTP within 4 SE', () => {
    const rows: string[] = [];
    // (a) and (b) collapse to (c): one roll, no decision after the bet.
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const r = mc((rng) => ({ paid: evalSpec.playRound(params, rng).multiplier, staked: 1 }), ROUNDS, 7100 + ci);
      rows.push(`(c) ${label.padEnd(22)} ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%`);
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    });

    // (d1) The most player-friendly picks by the exact scan (the grid rounds a few targets up by < 1 draw in 2^32).
    const ranked = (['over', 'under'] as const).flatMap((dir) => ALL_CHANCES.map((c) => ({ c, dir, rtp: exactRtp(c, dir) }))).sort((x, y) => y.rtp - x.rtp);
    for (const { c, dir } of ranked.slice(0, 3)) {
      const target = targetFor(c, dir);
      const r = mc((rng) => ({ paid: roll(rng.next(), target, dir).win ? multiplierFor(c) : 0, staked: 1 }), ROUNDS, 7200 + Math.round(c * 100));
      rows.push(`(d1) ${dir} ${c}%`.padEnd(26) + ` ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%`);
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se + 1e-9);
    }

    // (d2) Martingale at 49.5% (2×): double after a loss up to 2^10, reset after a win; RTP = returned / staked.
    {
      const c = 49.5;
      const target = targetFor(c, 'over');
      let stake = 1;
      const r = mc(
        (rng) => {
          const s = stake;
          const win = roll(rng.next(), target, 'over').win;
          stake = win || stake >= 1024 ? 1 : Math.round(stake * 2 * 100) / 100;
          return { paid: win ? s * multiplierFor(c) : 0, staked: s };
        },
        ROUNDS,
        7300,
      );
      rows.push(`(d2) martingale 2× at 49.5%     ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%`);
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
