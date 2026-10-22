import { fmtChance } from '@originals/game-sdk/ui';

/** A chance that may be vanishingly small, without scientific notation. */
export const fmtRisk = (p: number) => (p > 0 && p < 1e-4 ? '< 0.01%' : fmtChance(p));

/** A chance that may be within a hair of certain. */
export const fmtSafe = (p: number) => (p < 1 && p > 1 - 1e-4 ? '> 99.99%' : fmtChance(p));
