// slots:eval's Monte-Carlo worker (node:worker_threads, started by eval.ts with `--import tsx`).
//
// One worker holds compiled engines for the base spec, the feature spec and (with a modifier
// feature) the mechanic-free spec, and runs chunks on request:
//   { stream: 'base' | 'feature', chunk, n, seed }  n engine spins on seeds from Mulberry32(seed):
//       their (coins, K) counts (mc.ts spinChunk; K = the scatter count the pack's trigger read),
//       plus, for the base with a modifier feature and no split, the detect tally (spins on which
//       the mechanic ran, Σ(X − B0), Σ(X − B0)²; B0 = the mechanic-free board's pay);
//   { stream: 'cond', chunk, n, seed }  n trigger-conditional spins (conditional.ts): the joint
//       (X, B0, K, K0) counts.
// Each chunk's seed is mc.ts chunkSeed(seed, stream, chunk), chosen by eval.ts; the result depends
// only on the specs, the stream and that seed. eval.ts also imports `createTaskRunner` to run the
// same tasks in-process (--workers 0, the validity check).

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Mulberry32, SlotEngine, triggerScatters } from '../../packages/slots/src/engine/index';
import type { SlotSpec, SpinResult } from '../../packages/slots/src/engine/types';
import type { ModifierFeatureConfig } from '../../packages/slots/src/engine/analytics/config';
import {
  buildSplit,
  conditionalChunk,
  initialBoardValue,
  modifierDetected,
  specWithoutMechanic,
  splitRefusal,
  type CondCounts,
  type RawSpinLike,
  type SplitModel,
} from '../../packages/slots/src/engine/analytics/conditional';
import { spinChunk, spinScatterCount, type SpinCounts } from '../../packages/slots/src/engine/analytics/mc';
import type { ModifierDetectTally } from '../../packages/slots/src/engine/analytics/stats';

export type StreamName = 'base' | 'feature' | 'cond';

export interface WorkerInit {
  spec: SlotSpec;
  featureSpec: SlotSpec | null;
  modifier: ModifierFeatureConfig | null;
  /** Build the trigger-conditional split (eval.ts decided it is valid). */
  split: boolean;
}

export interface Task {
  stream: StreamName;
  chunk: number;
  n: number;
  seed: number;
}

export interface TaskResult {
  stream: StreamName;
  chunk: number;
  n: number;
  ms: number;
  counts?: SpinCounts;
  detect?: ModifierDetectTally;
  /** Detected spins whose B0 couldn't be computed (no mechanic-free spec). */
  detectNoB0?: number;
  cond?: CondCounts;
}

/** The scatter count K of an engine spin (mc.ts rule, with the engine's own terminal/base board choice). */
export function kOfEngine(spec: SlotSpec, engine: SlotEngine): (r: RawSpinLike) => number {
  return (r) => spinScatterCount(spec, r as unknown as SpinResult, { scatters: (x) => triggerScatters(engine, x) });
}

export function createTaskRunner(init: WorkerInit): (t: Task) => TaskResult {
  const engine = new SlotEngine(init.spec);
  const kBase = kOfEngine(init.spec, engine);
  const fEngine = init.featureSpec ? new SlotEngine(init.featureSpec) : null;
  const kFeat = fEngine ? kOfEngine(init.featureSpec!, fEngine) : null;
  const mf = init.modifier;
  let split: SplitModel | null = null;
  if (init.split && mf) split = buildSplit(init.spec, mf);
  // B0 for the detect tally: the model when the split's model applies, else the mechanic-free engine on the same seed
  let b0Of: ((r: RawSpinLike, seed: number) => number) | null = null;
  if (mf) {
    const why = splitRefusal(init.spec, { ...mf, trigger: mf.trigger ?? { symbols: [], minCount: 1 } });
    if (!why) {
      const sm = split ?? buildSplit(init.spec, { ...mf, trigger: mf.trigger ?? { symbols: [], minCount: 1 } });
      b0Of = (r) => initialBoardValue(sm, r.set, r.stops).b0;
    } else {
      try {
        const e0 = new SlotEngine(specWithoutMechanic(init.spec, mf.mechanic));
        b0Of = (_r, seed) => e0.spinRaw(new Mulberry32(seed)).totalCoins;
      } catch {
        b0Of = null;
      }
    }
  }
  const spinBase = (rng: Mulberry32) => engine.spinRaw(rng);
  return (t: Task): TaskResult => {
    const t0 = performance.now();
    if (t.stream === 'cond') {
      if (!split || !mf) throw new Error('cond task without a split');
      const cond = conditionalChunk(engine, split, mf, kBase, t.n, t.seed);
      return { stream: t.stream, chunk: t.chunk, n: t.n, ms: performance.now() - t0, cond };
    }
    if (t.stream === 'feature') {
      if (!fEngine || !kFeat) throw new Error('feature task without a feature spec');
      const counts = spinChunk(init.featureSpec!, (rng) => fEngine.spinRaw(rng), t.n, t.seed, { scatters: (r) => triggerScatters(fEngine, r) });
      return { stream: t.stream, chunk: t.chunk, n: t.n, ms: performance.now() - t0, counts };
    }
    let detect: ModifierDetectTally | undefined;
    let noB0 = 0;
    let onSpin: ((r: RawSpinLike, s: number) => void) | undefined;
    if (mf && !split) {
      const d: ModifierDetectTally = { n: t.n, detected: 0, sumD: 0, sumD2: 0 };
      detect = d;
      onSpin = (r, s) => {
        if (!modifierDetected(r, mf)) return;
        d.detected++;
        if (!b0Of) {
          noB0++;
          return;
        }
        const x = r.totalCoins - b0Of(r, s);
        d.sumD += x;
        d.sumD2 += x * x;
      };
    }
    const counts = spinChunk(init.spec, spinBase, t.n, t.seed, { scatters: (r) => triggerScatters(engine, r) }, onSpin);
    return { stream: t.stream, chunk: t.chunk, n: t.n, ms: performance.now() - t0, counts, detect, detectNoB0: noB0 };
  };
}

if (!isMainThread && parentPort && (workerData as { __slotsEvalWorker?: boolean })?.__slotsEvalWorker) {
  const port = parentPort;
  const run = createTaskRunner((workerData as { init: WorkerInit }).init);
  port.on('message', (t: Task) => {
    try {
      port.postMessage({ ok: true, result: run(t) });
    } catch (e) {
      port.postMessage({ ok: false, error: (e as Error).stack ?? String(e) });
    }
  });
}
