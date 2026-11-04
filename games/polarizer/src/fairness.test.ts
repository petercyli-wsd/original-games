// Fairness audit: can any way of playing Polarizer beat the RTP?
//
// A round as Game.tsx plays it: the bet emits the photon at 0° (a free
// checkpoint, worth RTP, no draw). At each checkpoint the player may cash out
// or fire the next polarizer, choosing its turn Δ (any chip that fits, or the
// rest to 90° when that is ≤ 85°). Firing draws u = rng.next() and the photon
// passes iff u < cos²Δ; passing multiplies the cash-out by 1/cos²Δ. Reaching
// 90° pays the cash-out. Settings are locked while live; Space and C call the
// same fire() / cashOut() as the buttons, and both are hidden while firing.
//
// Martingale check (exact): at every reachable angle and every turn the game
// can fire from there, the pass measure of the real passes() is cos²Δ and
// cos²Δ · afterPass(V, Δ) = V. The turn is the only mid-round decision and it
// leaves V unchanged at the moment of choosing (it only sets the variance).
// Sampled: 100k real draws per turn size match cos²Δ within 4 SE.
//
// Strategies (the outcome of a step is pass/fail, so a deterministic strategy
// follows one surviving path and its RTP is also computed exactly):
//   (a) fire while the next pass chance is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to 90° with the config's turn;
//   (d) grind then gamble: 5° turns while under the bet, the largest turn on
//       offer once ahead (the strongest use of the turn choice I could find);
//   (e) maximum variance: always the largest turn on offer (85° then 5°).
// On the 30°/60°/85° configs (a) cashes at RTP at once (cos²30° = 75% < 80%).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { GOAL, GRID, MAX_TURN, RTP, TURNS, afterPass, allowedTurn, maxFactor, nextTurn, passChance, passes, type Turn } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;

/** The turns the game offers at a checkpoint (Game.tsx turnOptions): chips that fit, plus the rest if ≤ 85°. */
function turnOptions(angle: number): number[] {
  const rest = GOAL - angle;
  const opts: number[] = TURNS.filter((t) => t <= rest);
  if (rest <= MAX_TURN && !opts.includes(rest)) opts.push(rest);
  return opts.sort((a, b) => a - b);
}

/** Picks the next turn size at a checkpoint (angle, cash), or null to cash out. */
type Policy = (angle: number, cash: number) => number | null;

const largest = (angle: number) => Math.max(...turnOptions(angle));

const STRATEGIES: { name: string; policy: (turn: Turn) => Policy }[] = [
  { name: '(a) fire while pass ≥ 80%', policy: (turn) => (angle) => (passChance(nextTurn(angle, turn)) >= 0.8 ? turn : null) },
  { name: '(b) take any profit', policy: (turn) => (_, cash) => (cash > 1 ? null : turn) },
  { name: '(c) play to 90°', policy: (turn) => () => turn },
  { name: '(d) 5° under the bet, largest when ahead', policy: () => (angle, cash) => (cash < 1 ? 5 : largest(angle)) },
  { name: '(e) always the largest turn', policy: () => (angle) => largest(angle) },
];

/** One round through the game's functions, in Game.tsx's order. */
function playRound(policy: Policy, rng: Rng): number {
  let angle = 0;
  let cash = RTP;
  for (;;) {
    const pick = policy(angle, cash);
    if (pick === null) return cash;
    const d = nextTurn(angle, pick);
    if (!passes(rng.next(), d)) return 0;
    cash = afterPass(cash, d);
    angle += d;
    if (angle >= GOAL) return cash;
  }
}

/** Exact RTP of a deterministic policy: one surviving path, stopped by the policy or at 90°. */
function exactRtp(policy: Policy): number {
  let angle = 0;
  let cash = RTP;
  let alive = 1;
  for (;;) {
    const pick = policy(angle, cash);
    if (pick === null) return alive * cash;
    const d = nextTurn(angle, pick);
    alive *= passChance(d);
    cash = afterPass(cash, d);
    angle += d;
    if (angle >= GOAL) return alive * cash;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** Every product of factors along any composition of 90° into allowed turns (brute force). */
function bruteMaxFactor(): number {
  let best = 0;
  const go = (angle: number, f: number) => {
    if (angle >= GOAL) {
      best = Math.max(best, f);
      return;
    }
    for (let d = GRID; d <= Math.min(MAX_TURN, GOAL - angle); d += GRID) go(angle + d, f / passChance(d));
  };
  go(0, 1);
  return best;
}

describe('Polarizer fairness', () => {
  it('martingale (exact): at every reachable angle and every turn on offer, the pass measure is cos²Δ and E[V after] = V', () => {
    let states = 0;
    const rng = createRng(seededSource(404));
    for (let angle = 0; angle < GOAL; angle += GRID) {
      // A spread of cash-outs per angle (the factor is multiplicative, so V scales out, but check anyway).
      for (const cash of [RTP, RTP * (1 + 9 * rng.next()), RTP * 0.37]) {
        for (const d of turnOptions(angle).map((t) => nextTurn(angle, t))) {
          states++;
          expect(allowedTurn(angle, d)).toBe(true);
          const p = passChance(d);
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
          // passes() is exactly [u < p]: the pass measure of u ~ U[0, 1) is p.
          expect(passes(p, d)).toBe(false);
          expect(passes(p * (1 - 1e-12), d)).toBe(true);
          expect(passes(0, d)).toBe(true);
          expect(Math.abs(p * afterPass(cash, d) - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    // Never a q = 1 step: every pick the UI can hold resolves to a turn of 5°..85° that stops at 90°.
    for (let angle = 0; angle < GOAL; angle += GRID) {
      for (const pick of [...TURNS, ...turnOptions(angle)]) expect(allowedTurn(angle, nextTurn(angle, pick))).toBe(true);
    }
  });

  it('martingale (sampled): 100k real draws per turn size pass at cos²Δ within 4 SE', () => {
    const rng = createRng(seededSource(77));
    for (const d of [5, 10, 15, 20, 30, 45, 60, 75, 85]) {
      const p = passChance(d);
      let pass = 0;
      for (let i = 0; i < SAMPLES; i++) if (passes(rng.next(), d)) pass++;
      expect(Math.abs(pass / SAMPLES - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / SAMPLES));
    }
  });

  it('the payout bound is honest: brute force over every path to 90° equals maxFactor, and the manifest covers it', () => {
    const brute = bruteMaxFactor();
    expect(Math.abs(brute - maxFactor(0)) / brute).toBeLessThan(1e-12);
    expect(RTP * brute).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('strategies (a)–(e) on every eval config: exactly RTP, and RTP within 4 SE through real draws', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { turn } }, ci) => {
      STRATEGIES.forEach(({ name, policy }, si) => {
        const pol = policy(turn);
        const exact = exactRtp(pol);
        expect(Math.abs(exact - RTP)).toBeLessThan(1e-12);
        const { mean, se, max } = mc((r) => playRound(pol, r), ROUNDS, 7100 + 17 * ci + si);
        rows.push(`${label.padEnd(22)} ${name.padEnd(42)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  exact ${(exact * 100).toFixed(4)}%  max ${max.toFixed(2)}×`);
        // + 1e-9: (a) on most configs always cashes at RTP at once (se = 0).
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
