import { defineEval, type Rng } from '@originals/game-sdk';
import { MIN_TARGET, autoEnd, cashAt, clampTarget, crashCents, timeTo } from './math';

// One config per volatility level. Each round samples how the player plays:
//  - an auto cash-out target spread log-uniformly around the level,
//  - a manual click at a random moment of the flight (any cent, not just targets),
//  - a "ride it" player with no target who holds on for a late click.
// Every one of these is a stopping rule, so each config should return 99%.
// (A player who never clicks is paid only by the 1,000,000× cap; that case is
// checked analytically in the tests, since it would swamp a simulation.)
const LEVELS = [
  { label: 'low (~1.1–1.6×)', lo: 1.1, hi: 1.6 },
  { label: 'medium (~1.6–4×)', lo: 1.6, hi: 4 },
  { label: 'high (~5–30×)', lo: 5, hi: 30 },
  { label: 'extreme (~50–500×)', lo: 50, hi: 500 },
];

const logUniform = (rng: Rng, lo: number, hi: number) => Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo)));

export default defineEval<{ lo: number; hi: number }>({
  configs: LEVELS.map(({ label, lo, hi }) => ({ label, params: { lo, hi } })),
  playRound({ lo, hi }, rng) {
    const crash = crashCents(rng.next());
    const style = rng.next();
    if (style < 0.55) {
      // Auto cash-out at a target.
      const target = clampTarget(logUniform(rng, lo, hi));
      const end = autoEnd(target, crash);
      return { multiplier: end.kind === 'crashed' ? 0 : end.cents / 100, steps: 1 };
    }
    if (style < 0.9) {
      // Manual click at a random time, somewhere in the level's band.
      // (The cash-out button opens at 1.01×, as in the game.)
      const tau = timeTo(logUniform(rng, Math.max(MIN_TARGET / 100, lo * 0.9), hi * 1.2));
      return { multiplier: cashAt(tau, crash) / 100, steps: 1 };
    }
    // Rides past the band and clicks late.
    return { multiplier: cashAt(timeTo(logUniform(rng, hi, hi * 3)), crash) / 100, steps: 1 };
  },
});
