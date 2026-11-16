// The pack's RNG, byte for byte (slot-math-engine-pack src/slotlab/rng.py).
//
// Integer-only contract: u32() -> [0, 2^32); randrange(n) by rejection (no modulo bias, n == 1
// consumes no draws); pickWeighted(cum) = bisect_right(cum, randrange(cum[last])). Draw order and
// draw counts are part of an engine's seed namespace, so every port follows the pack's order.

export interface SpinRng {
  u32(): number;
  randrange(n: number): number;
  pickWeighted(cum: readonly number[]): number;
}

const TWO32 = 4294967296;

export function randrangeOf(rng: { u32(): number }, n: number): number {
  if (!(n > 0)) throw new Error(`randrange(${n})`);
  if (n === 1) return 0; // normative: consumes no draws
  const lim = TWO32 - (TWO32 % n);
  for (;;) {
    const x = rng.u32();
    if (x < lim) return x % n;
  }
}

/** First index i with cum[i] > x (Python bisect.bisect_right). */
export function bisectRight(cum: readonly number[], x: number): number {
  let lo = 0;
  let hi = cum.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x < cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function pickWeightedOf(rng: { u32(): number }, cum: readonly number[]): number {
  if (!cum.length || cum[cum.length - 1] <= 0) throw new Error('pick_weighted: empty or zero-total thresholds');
  const x = randrangeOf(rng, cum[cum.length - 1]);
  return bisectRight(cum, x);
}

/** Integer weights -> cumulative thresholds for pickWeighted (refuses non-integers by name). */
export function cumThresholds(weights: readonly number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const w of weights) {
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 0) {
      throw new Error(`cum_thresholds: weight ${String(w)} is not a non-negative int`);
    }
    run += w;
    out.push(run);
  }
  if (run <= 0) throw new Error('cum_thresholds: total weight must be > 0');
  return out;
}

/** uint32-exact Mulberry32 (the pack's play/replay RNG). */
export class Mulberry32 implements SpinRng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  u32(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    const a = this.a;
    let t = Math.imul(a ^ (a >>> 15), a | 1) >>> 0;
    t = (((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0) ^ t) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }

  randrange(n: number): number {
    return randrangeOf(this, n);
  }

  pickWeighted(cum: readonly number[]): number {
    return pickWeightedOf(this, cum);
  }
}

/** Wraps an RNG and records every raw u32 (draw-count tests). */
export class TraceRng implements SpinRng {
  readonly trace: number[] = [];
  constructor(private readonly inner: { u32(): number }) {}
  u32(): number {
    const v = this.inner.u32();
    this.trace.push(v);
    return v;
  }
  randrange(n: number): number {
    return randrangeOf(this, n);
  }
  pickWeighted(cum: readonly number[]): number {
    return pickWeightedOf(this, cum);
  }
}
