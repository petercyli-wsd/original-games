// A seeded uniform RNG for analytics simulations (features.ts's direct simulator, tests).
// Mulberry32, the same uint32 stream as the engine's `Mulberry32` (../rng.ts), as a float in [0, 1).

import { Mulberry32 } from '../rng';

/** Seeded uniform in [0, 1): u32 / 2^32 of the engine's Mulberry32 stream. */
export function mulberry32(seed: number): () => number {
  const g = new Mulberry32(seed);
  return () => g.u32() / 4294967296;
}
