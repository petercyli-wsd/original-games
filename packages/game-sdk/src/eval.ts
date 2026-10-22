// Monte Carlo evals. Every game exports an EvalSpec from src/eval.ts and
// `npm run eval` checks the measured RTP against the manifest, alongside the
// stats used to compare prototypes (hit rate, volatility, round length).

import { createRng, seededSource } from './rng';
import type { Rng } from './types';

export interface RoundResult {
  /** Final payout multiplier (0 = loss). */
  multiplier: number;
  /** Player decisions or reveals in the round: a proxy for round length. */
  steps: number;
}

export interface EvalSpec<P = unknown> {
  /** Settings to evaluate, e.g. one per volatility level. */
  /**
   * Settings to evaluate. `rtp` overrides the manifest's target for one config,
   * for games whose bets carry different edges (e.g. baccarat's Tie).
   */
  configs: { label: string; params: P; rtp?: number }[];
  /**
   * Plays one round with a simulated player. Sample the player's strategy
   * (e.g. a random cash-out point) so the eval covers every strategy.
   */
  playRound(params: P, rng: Rng): RoundResult;
}

export const defineEval = <P>(spec: EvalSpec<P>) => spec;

export interface EvalReport {
  label: string;
  /** The config's own RTP target, when it overrides the manifest's. */
  targetRtp?: number;
  rounds: number;
  rtp: number;
  /** Standard error of the RTP estimate. */
  stdError: number;
  hitRate: number;
  /** Standard deviation of the multiplier: the volatility. */
  stdDev: number;
  p50: number;
  p99: number;
  max: number;
  avgSteps: number;
}

export function runEval<P>(spec: EvalSpec<P>, { rounds = 100_000, seed = 1 } = {}): EvalReport[] {
  return spec.configs.map(({ label, params, rtp: targetRtp }, i) => {
    const rng = createRng(seededSource(seed + i * 7919));
    const mults = new Float64Array(rounds);
    let sum = 0;
    let sumSq = 0;
    let hits = 0;
    let steps = 0;
    for (let r = 0; r < rounds; r++) {
      const res = spec.playRound(params, rng);
      mults[r] = res.multiplier;
      sum += res.multiplier;
      sumSq += res.multiplier ** 2;
      if (res.multiplier > 0) hits++;
      steps += res.steps;
    }
    mults.sort();
    const mean = sum / rounds;
    const stdDev = Math.sqrt(Math.max(0, sumSq / rounds - mean ** 2));
    return {
      label,
      targetRtp,
      rounds,
      rtp: mean,
      stdError: stdDev / Math.sqrt(rounds),
      hitRate: hits / rounds,
      stdDev,
      p50: mults[Math.floor(rounds * 0.5)],
      p99: mults[Math.floor(rounds * 0.99)],
      max: mults[rounds - 1],
      avgSteps: steps / rounds,
    };
  });
}
