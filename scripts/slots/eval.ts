// slots:eval — measure a slot's player experience (docs/SLOTS.md §3), check its oracle, write
// slot-facts.json.
//
//   npm run slots:eval -- <id|dir> [--workers N] [--budget-s 300] [--rtp-se 0.001] [--mc-spins N]
//                                  [--chunk N] [--rounds 200000] [--sessions 20000] [--seed 20261116]
//                                  [--validate-n 50000] [--no-split] [--no-write]
//
// <id> reads games/<id>/src/; a directory is used as given (e.g. the analytics fixture
// packages/slots/src/engine/analytics/fixtures/sample-game). Reads slot.spec.json, slot.config.json
// (validated) and the feature spec the config names. The maths is in
// packages/slots/src/engine/analytics (stats.ts has every method).
//
// How each spec is measured (the authority for its RTP, in order):
//   1. TS closed form (model.ts): exact distributions, exact RTP; no Monte Carlo of spins.
//   2. Modifier feature with a trigger (config.modifierFeature.trigger) whose mechanic-free spec has
//      a closed form: the trigger-conditional split (conditional.ts): RTP = E[B0] exact + P(T) exact ×
//      E[X − B0 | T] by Monte Carlo over triggering boards only. Used only after the validity check
//      (--validate-n unconditional spins: X = B0 and the same K outside T, T ⇔ the detect signal).
//   3. Otherwise engine Monte Carlo of the spec's spins (base and/or feature spin distributions).
//   The pack (oracle.json, when its specHash matches) anchors: a pack exact/exact_mixture RTP is the
//   base RTP when we have no closed form; a pack mc RTP replaces ours when its SE is smaller; and when
//   the award tables are flat (award(k) the same for every k ≥ scatter_min, retrigger likewise, the
//   feature spec's scatter_min = the retrigger table's smallest key) the feature RTP is exact from
//   P(trigger) and the feature spin's E[W] (TS exact or pack exact): Σ_j E[m_j 1{N ≥ j}]·E[W].
//
// Monte Carlo: node:worker_threads workers (eval-worker.ts, booted with tsx's ESM loader registered in
// the worker; default availableParallelism − 1; --workers 0 runs in-process) run
// chunks of --chunk spins (default 100,000; 20,000 trigger-conditional boards). Chunk i of stream s
// runs on mc.ts chunkSeed(seed, s, i), so the same flags and the same number of completed chunks per
// stream reproduce. The run stops when the RTP's SE ≤ --rtp-se (default 0.001 of the stake = 0.1% RTP)
// and no gate row is unresolved (stats.ts: an mc miss within 3 SE passes "within noise"; a max-win
// reach with 0 hits so far fails), eval keeps sampling to resolve those, or when --budget-s (default
// 300 s) runs out. With an exact (anchored) RTP the SE target applies to our own sample's mean. Chunks go to the stream whose
// next chunk cuts the RTP variance most per second. --mc-spins N runs exactly N per stream instead.
//
// Oracle check: oracle.json next to the spec (npm run slots:oracle -- <id>) must exist, its spec
// hashes must match the current specs, and the pack's RTP must equal ours: to 1e-9 when both are
// exact; for a pack mc RTP, the port replays the pack's own draw (its content seed, n_mc spins; one Mulberry32 stream for a cluster cascade, Mulberry32(seed + i) per spin otherwise)
// and must match to 1e-12; else within 4·√(se_ts² + se_pack²).
//
// Exit 1 when the oracle check fails or a §5 gate band fails (RTP, hit rate, dry streak, max-win
// reachability; a miss within noise passes); 2 on bad input.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { Mulberry32, SlotEngine } from '../../packages/slots/src/engine/index';
import type { RtpReport, SlotSpec } from '../../packages/slots/src/engine/types';
import { award, validateSlotConfig, type FreeSpinsConfig, type ModifierFeatureConfig, type SlotConfig } from '../../packages/slots/src/engine/analytics/config';
import { addCond, buildSplit, condFromMap, mechanicValueLaw, mergeTail, splitRefusal, validateSplit, type SplitValidation, type TailCounts } from '../../packages/slots/src/engine/analytics/conditional';
import { distProb, enumerationPlan, exactSpinDistribution, spinDistribution, type SpinDist } from '../../packages/slots/src/engine/analytics/distribution';
import { exactRtp, scatterCountDist, triggerProbability } from '../../packages/slots/src/engine/analytics/exact';
import { featureProfile } from '../../packages/slots/src/engine/analytics/features';
import { buildSlotFacts, canonicalJson, type OracleCheck, type OracleCheckItem } from '../../packages/slots/src/engine/analytics/facts';
import { chunkSeed, countsToDist, distRtpReport, mergeCounts } from '../../packages/slots/src/engine/analytics/mc';
import { buildModel } from '../../packages/slots/src/engine/analytics/model';
import { computeSlotStats, flatFeatureAnchor, flatTables, type FeatureAnchor, type ModifierDetectTally, type SlotStats, type SlotStatsInput } from '../../packages/slots/src/engine/analytics/stats';
import { createTaskRunner, kOfEngine, type StreamName, type Task, type TaskResult, type WorkerInit } from './eval-worker';

const ROOT = resolve(import.meta.dirname, '..', '..');
// The worker boots in plain JS: tsx's `--import` hooks don't resolve extensionless .ts imports inside
// worker threads (Node 24), so each worker registers tsx's ESM loader itself, then imports the entry.
const WORKER_BOOT = `import(${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href)})
  .then((m) => { m.register(); return import(${JSON.stringify(new URL('./eval-worker.ts', import.meta.url).href)}); })`;

function die(msg: string, code = 2): never {
  console.error(`slots:eval: ${msg}`);
  process.exit(code);
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const fmtInt = (x: number) => Math.round(x).toLocaleString('en-US');

function readJson<T>(path: string, what: string): { text: string; value: T } {
  if (!existsSync(path)) die(`${what} not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  try {
    return { text, value: JSON.parse(text) as T };
  } catch (e) {
    return die(`${what} is not valid JSON (${(e as Error).message}): ${path}`);
  }
}

// --------------------------------------------------------------------------- oracle (pack analytics)

interface PackAnalytics {
  rtp?: number;
  tier?: string;
  rtp_se?: number;
  se?: number;
  n_mc?: number;
  trigger_p?: number;
  instrument?: { seed?: number; n_mc?: number; method?: string };
}
interface OracleEntry {
  file?: string;
  specHash?: string;
  analytics?: PackAnalytics;
}
interface OracleDoc {
  schema?: string;
  base?: OracleEntry;
  features?: Record<string, OracleEntry>;
}

const isPackExact = (a: PackAnalytics | undefined): a is PackAnalytics & { rtp: number } =>
  !!a && typeof a.rtp === 'number' && (a.tier === 'exact' || a.tier === 'exact_mixture');

/** How the pack's Monte Carlo draws its spins (see packStream). */
type PackStream = 'per_spin_seed' | 'one_stream';
type Replay = (seed: number, n: number, pack: PackAnalytics) => RtpReport & { stream: PackStream };

/**
 * The pack's mc stream semantics, by analytics kind (slot-math-engine-pack src/reelengine/analytics):
 *   - a cluster evaluator (always a cascade) → analytics/cluster.py `mc_stream`: ONE Mulberry32(seed)
 *     stream across all n_mc spins (its instrument method reads "…over the tumble cascade…");
 *   - every other mc tier → analytics/mc.py `mc_analytics` (and the kernel hook battery,
 *     slotlab/kernel/mech.py): spin i on its own Mulberry32(seed + i).
 */
function packStream(spec: SlotSpec, a: PackAnalytics): PackStream {
  if (spec.evaluation.kind === 'cluster') return 'one_stream';
  if (/tumble cascade/.test(a.instrument?.method ?? '')) return 'one_stream';
  return 'per_spin_seed';
}

/** The pack's own mc draw replayed by the port (per its stream semantics), cached engine. */
function replayer(spec: SlotSpec): Replay {
  const eng = new SlotEngine(spec);
  return (seed, n, pack) => {
    const stream = packStream(spec, pack);
    let s1 = 0;
    let s2 = 0;
    const one = stream === 'one_stream' ? new Mulberry32(seed >>> 0) : null;
    for (let i = 0; i < n; i++) {
      const c = eng.spinRaw(one ?? new Mulberry32((seed + i) >>> 0)).totalCoins;
      s1 += c;
      s2 += c * c;
    }
    const bet = spec.bet.coins;
    const m = s1 / n;
    return { rtp: m / bet, tier: 'mc', se: Math.sqrt(Math.max(0, s2 / n - m * m) / n) / bet, n, stream };
  };
}

function compareRtp(name: string, file: string, specHash: string, entry: OracleEntry | undefined, ts: RtpReport, replay?: Replay): OracleCheckItem {
  if (!entry) return { name, file, ok: false, specHash, detail: `${file} is not in oracle.json` };
  const item: OracleCheckItem = { name, file, ok: false, specHash, oracleHash: entry.specHash, tsRtp: ts.rtp, tsTier: ts.tier, detail: '' };
  if (entry.specHash !== specHash) {
    item.detail = `stale: oracle specHash ${String(entry.specHash).slice(0, 12)}… ≠ current ${specHash.slice(0, 12)}…`;
    return item;
  }
  const a = entry.analytics ?? {};
  if (typeof a.rtp !== 'number') {
    item.detail = 'oracle.json has no analytics rtp (re-run without --no-analytics)';
    return item;
  }
  item.packRtp = a.rtp;
  item.packTier = a.tier;
  const seed = a.instrument?.seed;
  const nMc = a.n_mc ?? a.instrument?.n_mc;
  if (a.tier === 'mc' && replay && typeof seed === 'number' && typeof nMc === 'number') {
    // replay the pack's own Monte Carlo spin for spin: same seeds, same spins, same mean
    const r = replay(seed, nMc, a);
    item.tsRtp = r.rtp;
    item.tsTier = `mc (pack ${r.stream === 'one_stream' ? 'stream' : 'seeds'} replayed)`;
    item.diff = r.rtp - a.rtp;
    item.tolerance = 1e-12;
    item.ok = Math.abs(item.diff) <= item.tolerance;
    item.detail = `pack ${a.rtp.toFixed(10)} mc (n ${nMc}, seed ${seed}, ${r.stream === 'one_stream' ? 'one Mulberry32 stream' : 'Mulberry32(seed + i) per spin'}) replayed by the port: ${r.rtp.toFixed(10)}, |Δ| ${Math.abs(item.diff).toExponential(2)}${item.ok ? '' : ' (the port does not reproduce the pack spins)'}`;
    return item;
  }
  item.diff = ts.rtp - a.rtp;
  const bothExact = ts.tier !== 'mc' && a.tier !== 'mc';
  const packSe = a.rtp_se ?? a.se ?? 0;
  item.tolerance = bothExact ? 1e-9 : 4 * Math.sqrt((ts.se ?? 0) ** 2 + packSe ** 2);
  item.ok = Math.abs(item.diff) <= item.tolerance;
  item.detail = `pack ${a.rtp.toFixed(10)} ${a.tier}${packSe ? ` ± ${packSe.toExponential(2)}` : ''} vs ours ${ts.rtp.toFixed(10)} ${ts.tier}${ts.se ? ` ± ${ts.se.toExponential(2)}` : ''}: |Δ| ${Math.abs(item.diff).toExponential(2)} ${item.ok ? '≤' : '>'} ${item.tolerance.toExponential(1)}`;
  return item;
}

function checkOracle(
  dir: string,
  regen: string,
  doc: OracleDoc | null,
  docError: string | null,
  base: { file: string; hash: string; rtp: RtpReport; replay?: Replay },
  feature: { file: string; hash: string; rtp: RtpReport; replay?: Replay } | null,
): OracleCheck {
  if (docError) return { status: 'fail', detail: `oracle.json unreadable (${docError})`, checks: [] };
  if (!doc) return { status: 'missing', detail: `oracle.json missing: run ${regen}`, checks: [] };
  const checks: OracleCheckItem[] = [compareRtp('base', base.file, base.hash, doc.base, base.rtp, base.replay)];
  if (feature) {
    const name = Object.keys(doc.features ?? {}).find((k) => doc.features![k].file === feature.file);
    checks.push(compareRtp(name ?? 'feature', feature.file, feature.hash, name ? doc.features![name] : undefined, feature.rtp, feature.replay));
  }
  // any other feature spec the oracle lists must still match its file
  for (const [name, e] of Object.entries(doc.features ?? {})) {
    if (feature && e.file === feature.file) continue;
    const fp = join(dir, e.file ?? '');
    if (!e.file || !existsSync(fp)) {
      checks.push({ name, file: e.file ?? '?', ok: false, detail: `listed in oracle.json but ${e.file} is missing` });
      continue;
    }
    const text = readFileSync(fp, 'utf8');
    const spec = JSON.parse(text) as SlotSpec;
    let rtp: RtpReport;
    try {
      const ex = exactRtp(spec);
      rtp = { rtp: ex.rtp, tier: ex.tier };
    } catch {
      checks.push({ name, file: e.file, ok: e.specHash === sha256(canonicalJson(text)), detail: 'no closed form here: hash checked only' });
      continue;
    }
    checks.push(compareRtp(name, e.file, sha256(canonicalJson(text)), e, rtp));
  }
  const stale = checks.some((c) => c.detail.startsWith('stale'));
  const ok = checks.every((c) => c.ok);
  return {
    status: ok ? 'pass' : stale ? 'stale' : 'fail',
    detail: ok ? 'oracle.json matches the current specs and the pack RTP' : stale ? `stale oracle: re-run ${regen}` : 'oracle check failed',
    checks,
  };
}

// --------------------------------------------------------------------------- the worker pool

interface Runner {
  size: number;
  run(t: Task): Promise<TaskResult>;
  close(): Promise<void>;
}

function workerPool(n: number, init: WorkerInit): Runner {
  const idle: Worker[] = [];
  const all: Worker[] = [];
  const waiting: ((w: Worker) => void)[] = [];
  for (let i = 0; i < n; i++) {
    const w = new Worker(WORKER_BOOT, { eval: true, workerData: { __slotsEvalWorker: true, init } });
    w.unref();
    all.push(w);
    idle.push(w);
  }
  const acquire = () => new Promise<Worker>((res) => (idle.length ? res(idle.pop()!) : waiting.push(res)));
  const release = (w: Worker) => (waiting.length ? waiting.shift()!(w) : idle.push(w));
  return {
    size: n,
    async run(t) {
      const w = await acquire();
      try {
        return await new Promise<TaskResult>((res, rej) => {
          const onMsg = (m: { ok: boolean; result?: TaskResult; error?: string }) => {
            w.off('error', onErr);
            if (m.ok) res(m.result!);
            else rej(new Error(`worker: ${m.error}`));
          };
          const onErr = (e: Error) => {
            w.off('message', onMsg);
            rej(e);
          };
          w.once('message', onMsg);
          w.once('error', onErr);
          w.postMessage(t);
        });
      } finally {
        release(w);
      }
    },
    async close() {
      await Promise.all(all.map((w) => w.terminate()));
    },
  };
}

function localRunner(init: WorkerInit): Runner {
  const run = createTaskRunner(init);
  return {
    size: 1,
    run: async (t) => {
      await new Promise((r) => setImmediate(r));
      return run(t);
    },
    close: async () => {},
  };
}

// --------------------------------------------------------------------------- the Monte-Carlo state

const STREAM_ID: Record<StreamName, number> = { base: 0, feature: 1, cond: 2, tail: 3 };

interface StreamState {
  name: StreamName;
  chunk: number;
  /** Chunks dispatched / completed. */
  dispatched: number;
  completed: number;
  n: number;
  workerMs: number;
  counts: Map<number, number>;
  cond: Map<string, number>;
  undetected: number;
  detect: ModifierDetectTally;
  detectNoB0: number;
  tail: TailCounts;
}

const newStream = (name: StreamName, chunk: number): StreamState => ({
  name,
  chunk,
  dispatched: 0,
  completed: 0,
  n: 0,
  workerMs: 0,
  counts: new Map(),
  cond: new Map(),
  undetected: 0,
  detect: { n: 0, detected: 0, sumD: 0, sumD2: 0 },
  detectNoB0: 0,
  tail: { n: 0, hits: 0, sumW: 0, sumW2: 0, sumLoss: 0, sumLoss2: 0, sumAll: 0 },
});

function absorb(s: StreamState, r: TaskResult): void {
  s.completed++;
  s.n += r.n;
  s.workerMs += r.ms;
  if (r.counts) mergeCounts(s.counts, r.counts);
  if (r.cond) {
    addCond(s.cond, r.cond);
    s.undetected += r.cond.undetected;
  }
  if (r.detect) {
    s.detect.n += r.detect.n;
    s.detect.detected += r.detect.detected;
    s.detect.sumD += r.detect.sumD;
    s.detect.sumD2 += r.detect.sumD2;
  }
  s.detectNoB0 += r.detectNoB0 ?? 0;
  if (r.tail) mergeTail(s.tail, r.tail);
}

// --------------------------------------------------------------------------- printing

function printTable(s: SlotStats): void {
  const rows = s.rows.map((r) => [
    r.label,
    r.display,
    r.band?.text ?? '—',
    r.pass === null ? '—' : r.pass ? (r.withinNoise ? 'PASS (within noise)' : 'PASS') : r.gate ? 'FAIL (gate)' : 'FAIL',
  ]);
  const head = ['Measure', 'Value', 'Band', 'Result'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => `  ${r.map((c, i) => c.padEnd(w[i])).join('  ')}`.trimEnd();
  console.log(line(head));
  console.log(line(w.map((n) => '-'.repeat(n))));
  for (const r of rows) console.log(line(r));
}

// --------------------------------------------------------------------------- main

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      rounds: { type: 'string' },
      sessions: { type: 'string' },
      seed: { type: 'string' },
      'mc-spins': { type: 'string' },
      workers: { type: 'string' },
      'budget-s': { type: 'string' },
      'rtp-se': { type: 'string' },
      chunk: { type: 'string' },
      'validate-n': { type: 'string' },
      'no-split': { type: 'boolean' },
      'no-write': { type: 'boolean' },
    },
  });
  const arg = positionals[0];
  if (!arg) die('usage: npm run slots:eval -- <id|dir> [--workers N] [--budget-s S] [--rtp-se X] [--mc-spins N] [--chunk N] [--rounds N] [--sessions N] [--seed N] [--validate-n N] [--no-split] [--no-write]');
  const int = (v: string | undefined, d: number, what: string, min = 1) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) die(`--${what} must be an integer ≥ ${min}`);
    return n;
  };
  const num = (v: string | undefined, d: number, what: string) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!(n > 0)) die(`--${what} must be a positive number`);
    return n;
  };
  const rounds = int(values.rounds, 200_000, 'rounds');
  const sessions = int(values.sessions, 20_000, 'sessions');
  const seed = int(values.seed, 20261116, 'seed', 0);
  const fixedN = values['mc-spins'] !== undefined ? int(values['mc-spins'], 0, 'mc-spins') : null;
  const nWorkers = int(values.workers, Math.max(1, availableParallelism() - 1), 'workers', 0);
  const budgetS = num(values['budget-s'], 300, 'budget-s');
  const rtpSeTarget = num(values['rtp-se'], 0.001, 'rtp-se');
  const chunkOpt = values.chunk !== undefined ? int(values.chunk, 0, 'chunk') : null;
  const validateN = int(values['validate-n'], 50_000, 'validate-n');

  const asDir = resolve(arg);
  const isDir = existsSync(asDir) && statSync(asDir).isDirectory();
  const dir = isDir ? asDir : join(ROOT, 'games', arg, 'src');
  if (!existsSync(dir)) die(`no game '${arg}' (looked for ${dir})`);
  const game = isDir ? (basename(dir) === 'src' ? basename(dirname(dir)) : basename(dir)) : arg;
  const inGames = !isDir || resolve(dir) === join(ROOT, 'games', game, 'src');
  const regen = inGames ? `npm run slots:oracle -- ${game}` : `the pack (scripts/slots/oracle.py oracle_entry) for ${dir}`;

  const specR = readJson<SlotSpec>(join(dir, 'slot.spec.json'), 'slot.spec.json');
  const cfgR = readJson<SlotConfig>(join(dir, 'slot.config.json'), 'slot.config.json');
  const errs = validateSlotConfig(cfgR.value);
  if (errs.length) die(`slot.config.json is invalid:\n  - ${errs.join('\n  - ')}`);
  const spec = specR.value;
  const config = cfgR.value;
  const specHash = sha256(canonicalJson(specR.text));
  const bet = spec.bet.coins;

  let featureR: { text: string; value: SlotSpec } | null = null;
  if (config.feature) {
    featureR = readJson<SlotSpec>(join(dir, config.feature.spec), `feature spec ${config.feature.spec}`);
    const fb = featureR.value.bet?.coins;
    if (fb !== spec.bet.coins) die(`feature spec bet.coins ${fb} ≠ base bet.coins ${spec.bet.coins} (coins must share one unit)`);
    const smin = spec.trigger?.scatter_min;
    if (smin == null) die('config.feature is set but slot.spec.json has no trigger.scatter_min');
    const maxK = spec.geometry.rows.reduce((a, b) => a + b, 0);
    const bad: number[] = [];
    for (let k = Number(smin); k <= maxK; k++) if (award(config.feature.awards, k) < 1) bad.push(k);
    if (bad.length) die(`feature.awards gives no free spins for K = ${bad.join(', ')} (every K ≥ scatter_min ${smin} must award ≥ 1)`);
  }
  const fspec = featureR?.value ?? null;
  const featureHash = featureR ? sha256(canonicalJson(featureR.text)) : null;

  // the oracle and the fresh pack analytics
  const oraclePath = join(dir, 'oracle.json');
  let oracleDoc: OracleDoc | null = null;
  let oracleErr: string | null = null;
  if (existsSync(oraclePath)) {
    try {
      oracleDoc = JSON.parse(readFileSync(oraclePath, 'utf8')) as OracleDoc;
    } catch (e) {
      oracleErr = (e as Error).message;
    }
  }
  const packBase = oracleDoc?.base?.specHash === specHash ? oracleDoc.base.analytics : undefined;
  const packFeatEntry = fspec ? Object.values(oracleDoc?.features ?? {}).find((e) => e.file === config.feature!.spec) : undefined;
  const packFeat = packFeatEntry && packFeatEntry.specHash === featureHash ? packFeatEntry.analytics : undefined;

  const t0 = Date.now();
  const baseModel = buildModel(spec);
  const baseClosed = baseModel.closedFormRefusal === null;
  const featClosed = fspec ? buildModel(fspec).closedFormRefusal === null : true;
  const mf: ModifierFeatureConfig | null = config.modifierFeature ?? null;
  const notes: string[] = [];

  // ---- the modifier split: refusal, exact mechanic-free distribution, validity check
  let splitOn = false;
  let splitWhy = '';
  let validation: SplitValidation | null = null;
  let exactDist0: SpinDist | null = null;
  let pT = 0;
  if (mf && !baseClosed) {
    if (values['no-split']) splitWhy = '--no-split';
    else if (!mf.trigger) splitWhy = 'modifierFeature has no trigger (detect only)';
    else {
      const why = splitRefusal(spec, mf);
      if (why) splitWhy = why;
      else {
        const sm = buildSplit(spec, mf);
        const plan = enumerationPlan(sm.spec0);
        if (!plan.exact) splitWhy = `the mechanic-free spec can't be enumerated exactly (${plan.method})`;
        else {
          const eng = new SlotEngine(spec);
          validation = validateSplit(eng, sm, mf, kOfEngine(spec, eng), validateN, (seed ^ 0x2545f491) >>> 0);
          if (!validation.ok) splitWhy = `validity check failed on ${validateN.toLocaleString('en-US')} engine spins: ${validation.violations.join('; ')}`;
          else {
            splitOn = true;
            exactDist0 = exactSpinDistribution(sm.spec0);
            pT = sm.law.pT;
          }
        }
      }
    }
    notes.push(
      splitOn
        ? `modifier '${mf.name}' (${mf.mechanic}): trigger-conditional split (validity check passed on ${validateN.toLocaleString('en-US')} engine spins, ${validation!.triggered} triggered; P(T) = 1 in ${(1 / pT).toFixed(2)} exact)`
        : `modifier '${mf.name}' (${mf.mechanic}): plain Monte Carlo of the detect signal (split not used: ${splitWhy})`,
    );
  }

  // ---- the streams
  const streams: StreamState[] = [];
  if (splitOn) streams.push(newStream('cond', chunkOpt ?? 20_000));
  else if (!baseClosed || mf) streams.push(newStream('base', chunkOpt ?? 100_000));
  // the max-win tail of a split: importance-sampled triggering boards (conditional.ts tailChunk)
  if (splitOn && mf && mechanicValueLaw(spec, mf.mechanic)) streams.push(newStream('tail', chunkOpt ?? 20_000));
  if (fspec && !featClosed) streams.push(newStream('feature', chunkOpt ?? 100_000));
  const byName = (n: StreamName) => streams.find((s) => s.name === n) ?? null;
  // a closed-form base with a modifier only needs the base stream for the detect tally
  const baseForDetectOnly = baseClosed && !!mf && !!byName('base');

  // ---- exact parts
  const baseDistExact = baseClosed ? spinDistribution(spec, { mcSpins: 2_000_000, seed }) : null;
  const featDistExact = fspec && featClosed ? spinDistribution(fspec, { mcSpins: 2_000_000, seed: (seed ^ 0x5bd1e995) >>> 0 }) : null;

  // ---- the feature anchor (flat award tables): exact feature RTP from P(trigger) and E[W]
  let featureAnchor: FeatureAnchor | undefined;
  const cfg: FreeSpinsConfig | null = config.feature ?? null;
  if (cfg && fspec && baseClosed && featClosed && (baseDistExact?.tier === 'mc' || featDistExact?.tier === 'mc')) {
    // Both specs have closed forms but a joint distribution had to be sampled (too large to
    // enumerate). The free-spins RTP is still exact: its first moment needs only E[W] of a feature
    // spin and the scatter laws (features.ts: E[F] = Σ_j E[m_j 1{N ≥ j}]·E[W], and N depends on
    // the spins only through their K), all three exact from the closed forms, any award tables.
    const smin = Number(spec.trigger?.scatter_min);
    const pk = scatterCountDist(spec);
    const pkF = scatterCountDist(fspec);
    const law: SpinDist = { coins: pkF.map(() => 0), k: pkF.map((_, i) => i), p: pkF, tier: 'exact', method: 'feature-spin scatter law' };
    const ew = exactRtp(fspec).rtp * bet;
    let pTrig = 0;
    let eF = 0;
    for (let k = smin; k < pk.length; k++) {
      if (!pk[k]) continue;
      pTrig += pk[k];
      const n0 = Math.min(award(cfg.awards, k), cfg.maxSpins);
      if (n0 > 0) eF += pk[k] * featureProfile(law, cfg, n0).expectedMultiplierSum * ew;
    }
    featureAnchor = {
      featureRtp: eF / bet,
      triggerP: pTrig,
      averageWinStakes: pTrig > 0 ? eF / pTrig / bet : NaN,
      tier: exactRtp(spec).tier === 'exact_mixture' || exactRtp(fspec).tier === 'exact_mixture' ? 'exact_mixture' : 'exact',
      method: 'TS closed forms: P(K = k) base and feature, E[W] of a feature spin; Σ_k P(K=k)·Σ_j E[m_j 1{N ≥ j} | award(k)]·E[W]',
    };
    notes.push(`feature RTP anchored exactly: ${featureAnchor.method}`);
  } else if (cfg && fspec && !(baseClosed && featClosed)) {
    const ft = flatTables(spec, fspec, cfg);
    const why = [...ft.why];
    const fSmin = fspec.trigger?.scatter_min != null ? Number(fspec.trigger.scatter_min) : null;
    // P(trigger)
    let pTrig: number | null = null;
    let pTrigFrom = '';
    if (baseClosed) {
      pTrig = triggerProbability(spec);
      pTrigFrom = 'TS exact';
    } else if (isPackExact(packBase) && typeof packBase.trigger_p === 'number') {
      pTrig = packBase.trigger_p;
      pTrigFrom = `pack ${packBase.tier}`;
    } else why.push('no exact base trigger law (TS has no closed form, pack not exact)');
    // E[W] and the retrigger probability of a feature spin
    let ew: number | null = null;
    let pr = 0;
    let ewFrom = '';
    if (featClosed && featDistExact && featDistExact.tier === 'exact') {
      ew = exactRtp(fspec).rtp * bet;
      if (ft.rmin !== null) pr = distProb(featDistExact, (_c, k) => k >= ft.rmin!);
      ewFrom = 'TS exact';
    } else if (isPackExact(packFeat)) {
      ew = packFeat.rtp * bet;
      ewFrom = `pack ${packFeat.tier}`;
      if (ft.rmin !== null) {
        if (fSmin !== ft.rmin || typeof packFeat.trigger_p !== 'number') {
          why.push(`the feature spec's scatter_min (${fSmin}) ≠ the retrigger table's smallest key (${ft.rmin})`);
          ew = null;
        } else pr = packFeat.trigger_p;
      }
    } else why.push('no exact feature-spin RTP (TS has no closed form, pack not exact)');
    if (!why.length && pTrig !== null && ew !== null) {
      featureAnchor = flatFeatureAnchor(cfg, ft.smin, ft.rmin, pTrig, ew, pr, bet, `flat award tables: P(trigger) ${pTrigFrom} × E[W] ${ewFrom}`);
      notes.push(`feature RTP anchored exactly: ${featureAnchor.method}`);
    } else notes.push(`feature RTP from the free-spins algebra over sampled distributions (no exact anchor: ${why.join('; ')})`);
  }

  // ---- the Monte Carlo
  const run: Record<string, unknown> = {};
  let stopReason = 'no Monte Carlo of spins needed (closed forms)';
  const tMc = Date.now();
  /** Our own RTP of the base sample (the split's, or the sampled distribution's mean); null when exact. */
  const ownBase = (input: SlotStatsInput): RtpReport | null => {
    if (baseClosed) return null;
    const sp = input.split;
    if (sp) {
      const free = sp.exactDist.coins.reduce((a, c, i) => a + c * sp.exactDist.p[i], 0);
      let s1 = 0;
      let s2 = 0;
      sp.cond.count.forEach((c, j) => {
        const d = sp.cond.x[j] - sp.cond.b0[j];
        s1 += c * d;
        s2 += c * d * d;
      });
      const n = sp.cond.n;
      const m = s1 / n;
      return { rtp: (free + sp.pT * m) / bet, tier: 'mc', se: (sp.pT * Math.sqrt(Math.max(0, s2 / n - m * m) / n)) / bet, n };
    }
    return input.baseDist && input.baseDist.tier === 'mc' ? distRtpReport(input.baseDist, bet) : null;
  };
  /** The pack anchor for the base RTP (header): pack exact when we have no closed form; pack mc when tighter. */
  const anchorBase = (input: SlotStatsInput): { ourBase: RtpReport | null; authority: string } => {
    const ourBase = ownBase(input);
    let authority = baseClosed ? `TS ${baseModel.tier} closed form` : 'ours';
    if (!baseClosed && packBase && typeof packBase.rtp === 'number') {
      const packSe = packBase.rtp_se ?? packBase.se;
      if (isPackExact(packBase)) {
        input.baseRtp = { rtp: packBase.rtp, tier: packBase.tier as 'exact' | 'exact_mixture' };
        input.baseRtpMethod = `pack ${packBase.tier} (oracle.json, fresh; the TS model has no closed form: ${baseModel.closedFormRefusal})`;
        authority = `pack ${packBase.tier}`;
      } else if (packBase.tier === 'mc' && typeof packSe === 'number' && ourBase?.se !== undefined && packSe < ourBase.se) {
        input.baseRtp = { rtp: packBase.rtp, tier: 'mc', se: packSe, n: packBase.n_mc };
        input.baseRtpMethod = `pack mc (n ${packBase.n_mc}, ± ${pct(packSe, 4)}), tighter than ours (± ${pct(ourBase.se, 4)})`;
        authority = 'pack mc, tighter than ours';
      } else if (packBase.tier === 'mc' && ourBase) authority = `ours; the pack's mc ± ${pct(packSe ?? 0, 4)} is wider`;
    }
    return { ourBase, authority };
  };
  const previewInput = (st: StreamState[], forFinal: boolean): SlotStatsInput => {
    const s = (n: StreamName) => st.find((x) => x.name === n) ?? null;
    const b = s('base');
    const f = s('feature');
    const c = s('cond');
    const input: SlotStatsInput = {
      spec,
      featureSpec: fspec,
      config,
      mc: forFinal ? { rounds, sessions, seed } : { rounds: 20_000, sessions: 200, seed },
      featureAnchor,
    };
    if (c && exactDist0) {
      const cc = condFromMap(c.cond, c.n, c.undetected);
      input.split = { exactDist: exactDist0, pT, cond: cc, method: `trigger-conditional split: exact mechanic-free (B0, K) law + P(T) × ${c.n.toLocaleString('en-US')} paired triggering boards` };
    } else if (b && !baseForDetectOnly) {
      input.baseDist = countsToDist(b.counts, b.n, `Monte Carlo over ${b.n.toLocaleString('en-US')} engine spins (${b.completed} chunks of ${b.chunk.toLocaleString('en-US')}, chunk seeds from ${seed}); K = the scatter count the pack's trigger read`);
    } else if (baseDistExact) input.baseDist = baseDistExact;
    if (f) input.featureDist = countsToDist(f.counts, f.n, `Monte Carlo over ${f.n.toLocaleString('en-US')} engine feature spins (${f.completed} chunks of ${f.chunk.toLocaleString('en-US')})`);
    else if (featDistExact) input.featureDist = featDistExact;
    const tl = s('tail');
    if (input.split && tl && tl.n > 0) {
      const t = tl.tail;
      const n = t.n;
      const p = t.sumW / n;
      const loss = t.sumLoss / n;
      input.split.tail = {
        n,
        hits: t.hits,
        p,
        pSe: Math.sqrt(Math.max(0, t.sumW2 / n - p * p) / n),
        loss,
        lossSe: Math.sqrt(Math.max(0, t.sumLoss2 / n - loss * loss) / n),
        method: `${n.toLocaleString('en-US')} triggering boards with the ${mf!.mechanic} value draws from (1 − 0.1)·p + 0.1·(size-biased p), weighted by the likelihood ratio (${t.hits.toLocaleString('en-US')} at the cap; mean weight ${(t.sumAll / n).toFixed(4)})`,
      };
    }
    if (mf) input.modifier = { name: mf.name, mechanic: mf.mechanic, detect: b && !c ? b.detect : undefined };
    return input;
  };
  if (streams.length) {
    const init: WorkerInit = { spec, featureSpec: fspec, modifier: mf, split: splitOn, capCoins: Math.floor(config.maxWinStakes * bet) };
    const runner = nWorkers > 0 ? workerPool(nWorkers, init) : localRunner(init);
    const deadline = tMc + budgetS * 1000;
    const minN = (s: StreamState) => (s.name === 'cond' ? 100_000 : baseForDetectOnly ? 1_000_000 : 200_000);
    const quota = (s: StreamState) => (fixedN !== null ? Math.ceil(fixedN / s.chunk) : Infinity);
    let stopping = false;
    let lastEval = 0;
    let evalEvery = 3000;
    let parts = { base: 1, feature: 1 } as Record<string, number>;
    let lastStats: SlotStats | null = null;
    // the tail stream runs until the reach estimate is tight (rel SE ≤ 20%, ≥ 10 hits); the others until the RTP target
    let tailWants = true;
    let mainWants = true;
    const pick = (): StreamState | null => {
      let open = streams.filter((s) => s.dispatched < quota(s));
      if (!open.length) return null;
      const tl = open.find((s) => s.name === 'tail');
      if (tl) {
        const rest = open.filter((s) => s !== tl);
        const restN = Math.max(0, ...rest.map((s) => s.dispatched * s.chunk));
        if (fixedN !== null || (tailWants && mainWants)) {
          if (!rest.length || tl.dispatched * tl.chunk <= restN) return tl;
        } else if (tailWants) return tl;
        open = rest.length ? rest : open;
      }
      if (open.length === 1) return open[0];
      // until each stream has its minimum, round-robin; then the largest variance cut per second
      const young = open.filter((s) => s.dispatched * s.chunk < minN(s));
      if (young.length) return young.reduce((a, b) => (b.dispatched < a.dispatched ? b : a));
      let best: StreamState | null = null;
      let bestScore = -1;
      for (const s of open) {
        const v = s.name === 'feature' ? parts.feature : parts.base;
        const nNow = Math.max(1, s.completed * s.chunk);
        const a = v * nNow; // variance × n (≈ constant)
        const nd = s.dispatched * s.chunk;
        const t = s.completed ? s.workerMs / s.n : 1;
        const score = a / (nd * nd * t);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    };
    const inflight = new Set<Promise<void>>();
    const dispatch = (s: StreamState) => {
      const i = s.dispatched++;
      const task: Task = { stream: s.name, chunk: i, n: s.chunk, seed: chunkSeed(seed, STREAM_ID[s.name], i) };
      const p: Promise<void> = runner.run(task).then((r) => {
        absorb(s, r);
        inflight.delete(p);
      });
      inflight.add(p);
    };
    const evaluate = (): void => {
      const te = Date.now();
      const input = previewInput(streams, false);
      const { ourBase } = anchorBase(input);
      const st = computeSlotStats(input);
      lastStats = st;
      // an exact (anchored) RTP has no SE: the target then applies to our own sample's mean, the
      // precision of the sampled distributions behind the other rows
      const own = st.rtpUncappedTier === 'mc' ? null : ourBase;
      parts = own ? { base: (own.se ?? 0) ** 2, feature: 0 } : { base: st.rtpSeParts.base ** 2, feature: st.rtpSeParts.feature ** 2 };
      const se = st.rtpUncappedTier === 'mc' ? st.rtpUncappedSe ?? Infinity : own?.se ?? 0;
      // unresolved gate rows: within noise, or a reach the sample hasn't seen yet (0 hits, mc): sample on
      const noisy = st.rows.filter((r) => r.gate && (r.withinNoise || (r.key === 'maxWinReach' && r.tier === 'mc' && r.pass === false && r.value === 0))).map((r) => r.key);
      const enough = streams.every((s) => s.n >= minN(s));
      const reach = st.rows.find((r) => r.key === 'maxWinReach')!;
      const tlS = byName('tail');
      const tailOk = !tlS || (reach.value !== null && reach.value > 0 && tlS.tail.hits >= 10 && (reach.se ?? Infinity) <= 0.2 * reach.value && !reach.withinNoise);
      tailWants = !tailOk;
      mainWants = !(se <= rtpSeTarget && !noisy.filter((k) => k !== 'maxWinReach').length);
      const elapsed = (Date.now() - tMc) / 1000;
      process.stderr.write(
        `  [mc ${elapsed.toFixed(0)} s] ${streams.map((s) => `${s.name} ${fmtInt(s.n)}`).join(', ')}; RTP ${pct(st.rtpUncapped, 3)} ${st.rtpUncappedTier === 'mc' ? `± ${pct(se, 3)}` : `${st.rtpUncappedTier} (sample mean ± ${pct(se, 3)})`}${noisy.length ? `; unresolved: ${noisy.join(', ')}` : ''}\n`,
      );
      if (fixedN === null && enough && se <= rtpSeTarget && !noisy.length && tailOk) {
        stopping = true;
        stopReason = `${own ? 'base sample mean' : 'RTP'} SE ${pct(se, 3)} ≤ target ${pct(rtpSeTarget, 3)}, every gate row resolved${tlS ? `, max-win reach ± ${(((reach.se ?? 0) / (reach.value ?? 1)) * 100).toFixed(0)}%` : ''}`;
      }
      evalEvery = Math.max(3000, 5 * (Date.now() - te));
      lastEval = Date.now();
    };
    try {
      for (;;) {
        while (!stopping && inflight.size < runner.size) {
          const s = pick();
          if (!s) break;
          dispatch(s);
        }
        if (!inflight.size) break;
        await Promise.race(inflight);
        if (stopping) continue;
        if (fixedN === null && Date.now() >= deadline) {
          stopping = true;
          const st = lastStats as SlotStats | null;
          const noisy = st ? st.rows.filter((r) => r.gate && (r.withinNoise || (r.key === 'maxWinReach' && r.tier === 'mc' && r.pass === false && r.value === 0))).map((r) => r.key) : [];
          stopReason = `time budget ${budgetS} s reached${noisy.length ? ` (still unresolved: ${noisy.join(', ')})` : ''}`;
        } else if (fixedN === null && Date.now() - lastEval >= evalEvery && streams.every((s) => s.completed > 0)) evaluate();
      }
      if (fixedN !== null) stopReason = `fixed --mc-spins ${fixedN.toLocaleString('en-US')} per stream`;
    } finally {
      await runner.close();
    }
    const wall = (Date.now() - tMc) / 1000;
    run.workers = nWorkers;
    run.wallSeconds = Number(wall.toFixed(1));
    run.stop = stopReason;
    run.rtpSeTarget = rtpSeTarget;
    run.budgetSeconds = budgetS;
    run.streams = Object.fromEntries(
      streams.map((s) => [s.name, { n: s.n, chunks: s.completed, chunk: s.chunk, perSecondWall: Math.round(s.n / wall), perSecondPerWorker: Math.round(s.n / (s.workerMs / 1000)) }]),
    );
    if (byName('cond')?.undetected) notes.push(`WARNING: ${byName('cond')!.undetected} conditional samples did not fire the detect signal`);
    if (byName('base')?.detectNoB0) notes.push(`WARNING: ${byName('base')!.detectNoB0} detected spins had no B0 (no mechanic-free spec)`);
  }

  // ---- the final statistics, with the pack anchor for the base RTP
  const finalInput = previewInput(streams, true);
  const { ourBase, authority: baseAuthority } = anchorBase(finalInput);
  const stats = computeSlotStats(finalInput);

  // ---- oracle
  const baseRtpForOracle: RtpReport = baseClosed ? { rtp: exactRtp(spec).rtp, tier: exactRtp(spec).tier } : ourBase ?? { rtp: stats.baseRtp, tier: stats.baseRtpTier, se: stats.baseRtpSe };
  let featRtpForOracle: RtpReport | null = null;
  if (fspec) {
    if (featClosed) {
      const ex = exactRtp(fspec);
      featRtpForOracle = { rtp: ex.rtp, tier: ex.tier };
    } else featRtpForOracle = distRtpReport(finalInput.featureDist!, bet);
  }
  const oracle = checkOracle(
    dir,
    regen,
    oracleDoc,
    oracleErr,
    { file: 'slot.spec.json', hash: specHash, rtp: baseRtpForOracle, replay: baseClosed ? undefined : replayer(spec) },
    fspec && featRtpForOracle ? { file: config.feature!.spec, hash: featureHash!, rtp: featRtpForOracle, replay: featClosed ? undefined : replayer(fspec) } : null,
  );

  // ---- report
  console.log(`slots:eval ${game} (${dir.startsWith(ROOT) ? dir.slice(ROOT.length + 1) : dir})`);
  console.log(`  base: ${stats.distributions.base.method} (${stats.distributions.base.entries.toLocaleString('en-US')} entries)`);
  if (stats.distributions.feature) console.log(`  feature: ${stats.distributions.feature.method} (${stats.distributions.feature.entries.toLocaleString('en-US')} outcomes)`);
  for (const n of notes) console.log(`  ${n}`);
  console.log('');
  printTable(stats);
  console.log('');
  const capTxt =
    stats.capLoss.tier === 'mc' && stats.capLoss.hits === 0
      ? `not observed (0 of ${stats.capLoss.n?.toLocaleString('en-US')} simulated rounds above the cap${stats.capLoss.upperBound !== undefined ? `; exact upper bound ${pct(stats.capLoss.upperBound, 5)}` : ''})`
      : `${pct(stats.capLoss.value, 5)} ${stats.capLoss.tier}${stats.capLoss.se ? ` ± ${pct(stats.capLoss.se, 5)}` : ''}`;
  const se = (x?: number) => (x !== undefined ? ` ± ${pct(x, 4)}` : '');
  console.log(
    `  RTP split: base ${pct(stats.baseRtp, 4)} ${stats.baseRtpTier}${se(stats.baseRtpSe)} [${baseAuthority}]` +
      (stats.baseSplit ? ` = mechanic-free ${pct(stats.baseSplit.mechanicFree, 4)} exact + ${mf?.name ?? 'modifier'} ${pct(stats.baseSplit.modifier, 4)}${se(stats.baseSplit.modifierSe)}` : '') +
      ` + feature ${pct(stats.featureRtp, 4)} (${stats.featureRtpTier}) = uncapped ${pct(stats.rtpUncapped, 4)} (${stats.rtpUncappedTier}${se(stats.rtpUncappedSe)}); cap loss ${capTxt}`,
  );
  if (stats.feature && config.feature) {
    const f = stats.feature;
    const fc = config.feature;
    console.log(`  Feature: free spins ${JSON.stringify(fc.awards)}, retrigger ${fc.retrigger ? JSON.stringify(fc.retrigger) : 'none'}, max ${fc.maxSpins}, multiplier ${JSON.stringify(fc.multiplier)}`);
    console.log(
      `    trigger 1 in ${f.frequency.toFixed(1)}, E[spins] ${f.expectedSpins.toFixed(2)}, E[win] ${f.averageWinStakes.toFixed(2)}× (SD ${f.sdWinStakes.toFixed(1)}×), P(feature pays 0) ${pct(f.pZero, 2)}, share ${pct(f.share, 1)} (${f.tier})`,
    );
    for (const r of f.byK) console.log(`    K=${r.k}: P ${r.pK.toExponential(3)}, ${r.spins} spins → E[spins] ${r.expectedSpins.toFixed(2)}, E[win] ${r.averageWinStakes.toFixed(2)}×`);
    console.log(`    buy price: ${f.buyPriceStakes !== null ? `${f.buyPriceStakes.toFixed(2)}× the stake (E[F | trigger] ÷ target RTP ${config.targetRtp})` : 'no buy offered'}`);
  }
  if (stats.modifier) {
    const m = stats.modifier;
    console.log(
      `  Modifier feature '${m.name}' (${m.mechanic}, ${m.method}, ${m.role === 'smaller' ? 'smaller feature' : 'the game\'s feature'}): 1 in ${m.frequency.toFixed(2)} (${m.frequencyTier}${m.frequencySe !== undefined ? ` ± ${m.frequencySe.toFixed(2)}` : ''}), ` +
        `average win ${m.averageWinStakes.toFixed(3)}×${m.averageWinSe !== undefined ? ` ± ${m.averageWinSe.toFixed(3)}` : ''}, share ${pct(m.share, 2)}${m.shareSe !== undefined ? ` ± ${pct(m.shareSe, 2)}` : ''}, ` +
        `RTP part ${pct(m.rtpContribution, 3)}${se(m.rtpContributionSe)} (n ${m.n.toLocaleString('en-US')})`,
    );
  }
  const r = stats.reach;
  const reachRow = stats.rows.find((x) => x.key === 'maxWinReach')!;
  console.log(
    `  Max-win reach: P(X ≥ ${stats.maxWinStakes}×) = ${r.best === null ? 'unresolved' : `${r.best.toExponential(3)}${reachRow.se !== undefined ? ` ± ${reachRow.se.toExponential(2)}` : ''} (1 in ${(1 / r.best).toExponential(3)})`}, ` +
      `interval [${r.interval[0].toExponential(3)}, ${r.interval[1].toExponential(3)}] (${reachRow.tier})${r.mc ? `, ${r.mc.hits} hits in ${r.mc.n?.toLocaleString('en-US')}` : ''}`,
  );
  console.log(`  Session: mean ${stats.session.meanStakes.toFixed(1)}, median ${stats.session.medianStakes.toFixed(1)} stakes, P(bust) ${pct(stats.session.pBust, 1)} ± ${pct(stats.session.seBust, 1)}`);
  console.log('');
  console.log(`  Oracle: ${oracle.status === 'pass' ? 'PASS' : 'FAIL'} (${oracle.detail})`);
  for (const c of oracle.checks) console.log(`    ${c.ok ? 'ok  ' : 'FAIL'} ${c.name} (${c.file}): ${c.detail}`);
  if (streams.length) {
    const streamsTxt = streams
      .map((s) => `${s.name} ${fmtInt(s.n)} (${s.completed} chunks; ${fmtInt(s.n / Number(run.wallSeconds))}/s wall, ${fmtInt(s.n / (s.workerMs / 1000))}/s per worker)`)
      .join(', ');
    console.log(`  Monte Carlo: ${streamsTxt}; ${nWorkers || 'in-process, 0'} workers, ${run.wallSeconds} s; stop: ${stopReason}`);
  } else console.log(`  Monte Carlo: ${stopReason}`);

  const facts = buildSlotFacts({ game, specHash, featureSpecHash: featureHash, config, stats, oracle, run: streams.length ? run : { stop: stopReason } });
  const out = join(dir, 'slot-facts.json');
  if (!values['no-write']) {
    writeFileSync(out, JSON.stringify(facts, null, 2) + '\n', 'utf8');
    console.log(`  wrote ${out.startsWith(ROOT) ? out.slice(ROOT.length + 1) : out}`);
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s; ${rounds.toLocaleString('en-US')} rounds per conditional estimate, ${sessions.toLocaleString('en-US')} sessions, seed ${seed})`);

  const failures: string[] = [];
  if (oracle.status !== 'pass') failures.push(`oracle: ${oracle.detail}`);
  for (const key of stats.gateFailed) {
    const row = stats.rows.find((x) => x.key === key)!;
    failures.push(`${row.label} ${row.display} outside ${row.band?.text}`);
  }
  if (failures.length) {
    console.log(`\n  GATE FAIL:\n${failures.map((f) => `    - ${f}`).join('\n')}`);
    process.exit(1);
  }
  const noisyGate = stats.rows.filter((x) => x.gate && x.withinNoise).map((x) => x.label);
  console.log(`\n  GATE PASS (oracle, RTP, hit rate, dry streak, max-win reachability)${noisyGate.length ? `; within noise: ${noisyGate.join(', ')}` : ''}`);
}

main().catch((e) => die((e as Error).stack ?? String(e)));
