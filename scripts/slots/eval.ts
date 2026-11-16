// slots:eval — measure a slot's player experience (docs/SLOTS.md §3), check its oracle, write
// slot-facts.json.
//
//   npm run slots:eval -- <id|dir> [--rounds 200000] [--sessions 20000] [--seed 20261116]
//                                  [--mc-spins 200000] [--no-write]
//
// <id> reads games/<id>/src/; a directory is used as given (e.g. the analytics fixture
// packages/slots/src/engine/analytics/fixtures/sample-game). Reads slot.spec.json, slot.config.json
// (validated) and the feature spec the config names. The maths is in
// packages/slots/src/engine/analytics (stats.ts has every method). A spec with no closed form
// (mechanics, cascades, cluster, height laws) is measured by Monte Carlo through the engine port's
// canonicalSpin (dynamic import of packages/slots/src/engine/index.ts), tier mc with se and n.
//
// Oracle check: oracle.json next to the spec (npm run slots:oracle -- <id>) must exist, its spec
// hashes must match the current specs, and the pack's RTP must equal ours: to 1e-9 when both are
// exact; for a pack mc RTP, the port replays the pack's own draw (its content seed + i, n_mc spins)
// and must match to 1e-12; else within 4·√(se_ts² + se_pack²). For a fixture directory the oracle is regenerated with
// the pack's venv (scripts/slots/oracle.py's oracle_entry, game format, few seeds).
//
// Exit 1 when the oracle check fails or a §5 gate band fails (RTP, hit rate, dry streak, max-win
// reachability); 2 on bad input.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { RtpReport, SlotSpec, SpinResult } from '../../packages/slots/src/engine/types';
import { award, validateSlotConfig, type SlotConfig } from '../../packages/slots/src/engine/analytics/config';
import { spinDistribution, type SpinDist } from '../../packages/slots/src/engine/analytics/distribution';
import { exactRtp } from '../../packages/slots/src/engine/analytics/exact';
import { buildSlotFacts, canonicalJson, type OracleCheck, type OracleCheckItem } from '../../packages/slots/src/engine/analytics/facts';
import { distRtpReport, mcRtp, mcSpinDistribution, type McOptions, type SpinFn } from '../../packages/slots/src/engine/analytics/mc';
import { buildModel } from '../../packages/slots/src/engine/analytics/model';
import { computeSlotStats, type SlotStats } from '../../packages/slots/src/engine/analytics/stats';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ENGINE_INDEX = join(ROOT, 'packages', 'slots', 'src', 'engine', 'index.ts');

function die(msg: string, code = 2): never {
  console.error(`slots:eval: ${msg}`);
  process.exit(code);
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function readJson<T>(path: string, what: string): { text: string; value: T } {
  if (!existsSync(path)) die(`${what} not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  try {
    return { text, value: JSON.parse(text) as T };
  } catch (e) {
    return die(`${what} is not valid JSON (${(e as Error).message}): ${path}`);
  }
}

// --------------------------------------------------------------------------- engine (no closed form)

interface EngineMod {
  canonicalSpin?: (spec: SlotSpec, seed: number) => SpinResult;
  SlotEngine?: new (spec: SlotSpec) => unknown;
  triggerScatters?: (engine: unknown, result: SpinResult) => number;
}
let engineMod: EngineMod | null = null;

async function engineSpin(spec: SlotSpec, why: string): Promise<{ spin: SpinFn; opts: McOptions }> {
  if (!engineMod) {
    try {
      engineMod = (await import(pathToFileURL(ENGINE_INDEX).href)) as EngineMod;
    } catch (e) {
      die(`${spec.slug}: no closed form (${why}) and the engine port can't be loaded (${(e as Error).message})`);
    }
  }
  if (typeof engineMod.canonicalSpin !== 'function')
    die(`${spec.slug}: no closed form (${why}); Monte Carlo needs canonicalSpin(spec, seed) exported from packages/slots/src/engine/index.ts, which isn't there yet`);
  const opts: McOptions = {};
  if (typeof engineMod.SlotEngine === 'function' && typeof engineMod.triggerScatters === 'function') {
    const eng = new engineMod.SlotEngine(spec);
    const ts = engineMod.triggerScatters;
    opts.scatters = (r) => ts(eng, r);
  }
  return { spin: engineMod.canonicalSpin, opts };
}

/** The spin distribution and RTP of a spec: closed form when there is one, else engine Monte Carlo. */
type Replay = (seed: number, n: number) => RtpReport;

async function measureSpec(spec: SlotSpec, mcSpins: number, seed: number): Promise<{ dist: SpinDist; rtp: RtpReport; closed: boolean; replay?: Replay }> {
  const m = buildModel(spec);
  if (m.closedFormRefusal === null) {
    const dist = spinDistribution(spec, { mcSpins, seed });
    const ex = exactRtp(spec);
    return { dist, rtp: { rtp: ex.rtp, tier: ex.tier }, closed: true };
  }
  const { spin, opts } = await engineSpin(spec, m.closedFormRefusal);
  const dist = mcSpinDistribution(spec, spin, mcSpins, seed, opts);
  // the pack's own mc draw (Mulberry32(content_seed + i)), for the oracle check
  const replay: Replay = (s, n) => mcRtp(spec, spin, n, s, { ...opts, consecutiveSeeds: true });
  return { dist, rtp: distRtpReport(dist, spec.bet.coins), closed: false, replay };
}

// --------------------------------------------------------------------------- oracle

interface OracleEntry {
  file?: string;
  specHash?: string;
  analytics?: { rtp?: number; tier?: string; rtp_se?: number; se?: number; n_mc?: number; instrument?: { seed?: number; n_mc?: number } };
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
    const r = replay(seed, nMc);
    item.tsRtp = r.rtp;
    item.tsTier = 'mc (pack seeds replayed)';
    item.diff = r.rtp - a.rtp;
    item.tolerance = 1e-12;
    item.ok = Math.abs(item.diff) <= item.tolerance;
    item.detail = `pack ${a.rtp.toFixed(10)} mc (n ${nMc}, seed ${seed}) replayed by the port: ${r.rtp.toFixed(10)}, |Δ| ${Math.abs(item.diff).toExponential(2)}${item.ok ? '' : ' (the port does not reproduce the pack spins)'}`;
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
  base: { file: string; hash: string; rtp: RtpReport; replay?: Replay },
  feature: { file: string; hash: string; rtp: RtpReport; replay?: Replay } | null,
): OracleCheck {
  const path = join(dir, 'oracle.json');
  if (!existsSync(path)) return { status: 'missing', detail: `oracle.json missing: run ${regen}`, checks: [] };
  let doc: { schema?: string; base?: OracleEntry; features?: Record<string, OracleEntry> };
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { status: 'fail', detail: `oracle.json unreadable (${(e as Error).message})`, checks: [] };
  }
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

// --------------------------------------------------------------------------- printing

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

function printTable(s: SlotStats): void {
  const rows = s.rows.map((r) => [r.label, r.display, r.band?.text ?? '—', r.pass === null ? '—' : r.pass ? 'PASS' : r.gate ? 'FAIL (gate)' : 'FAIL']);
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
      'no-write': { type: 'boolean' },
    },
  });
  const arg = positionals[0];
  if (!arg) die('usage: npm run slots:eval -- <id|dir> [--rounds N] [--sessions N] [--seed N] [--mc-spins N] [--no-write]');
  const int = (v: string | undefined, d: number, what: string) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) die(`--${what} must be a positive integer`);
    return n;
  };
  const rounds = int(values.rounds, 200_000, 'rounds');
  const sessions = int(values.sessions, 20_000, 'sessions');
  const seed = int(values.seed, 20261116, 'seed');
  const mcSpins = int(values['mc-spins'], 200_000, 'mc-spins');

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

  const t0 = Date.now();
  const base = await measureSpec(spec, mcSpins, seed);
  const feat = featureR ? await measureSpec(featureR.value, mcSpins, (seed ^ 0x5bd1e995) >>> 0) : null;
  const stats = computeSlotStats({
    spec,
    featureSpec: featureR?.value ?? null,
    config,
    baseDist: base.dist,
    featureDist: feat?.dist,
    baseRtp: base.rtp,
    mc: { rounds, sessions, seed },
  });
  const featureHash = featureR ? sha256(canonicalJson(featureR.text)) : null;
  const oracle = checkOracle(
    dir,
    regen,
    { file: 'slot.spec.json', hash: specHash, rtp: base.rtp, replay: base.replay },
    featureR && feat ? { file: config.feature!.spec, hash: featureHash!, rtp: feat.rtp, replay: feat.replay } : null,
  );

  console.log(`slots:eval ${game} (${dir.startsWith(ROOT) ? dir.slice(ROOT.length + 1) : dir})`);
  console.log(
    `  base: ${base.dist.method} (${base.dist.p.length.toLocaleString('en-US')} outcomes)` +
      (feat ? `\n  feature: ${feat.dist.method} (${feat.dist.p.length.toLocaleString('en-US')} outcomes)` : ''),
  );
  console.log('');
  printTable(stats);
  console.log('');
  const capTxt =
    stats.capLoss.tier === 'mc' && stats.capLoss.hits === 0
      ? `not observed (0 of ${stats.capLoss.n?.toLocaleString('en-US')} simulated rounds above the cap${stats.capLoss.upperBound !== undefined ? `; exact upper bound ${pct(stats.capLoss.upperBound, 5)}` : ''})`
      : `${pct(stats.capLoss.value, 5)} ${stats.capLoss.tier}${stats.capLoss.se ? ` ± ${pct(stats.capLoss.se, 5)}` : ''}`;
  console.log(
    `  RTP split: base ${pct(stats.baseRtp, 4)} (${stats.baseRtpTier}) + feature ${pct(stats.featureRtp, 4)} = uncapped ${pct(stats.rtpUncapped, 4)} (${stats.rtpUncappedTier}); cap loss ${capTxt}`,
  );
  if (stats.feature && config.feature) {
    const f = stats.feature;
    const fc = config.feature;
    console.log(
      `  Feature: free spins ${JSON.stringify(fc.awards)}, retrigger ${fc.retrigger ? JSON.stringify(fc.retrigger) : 'none'}, max ${fc.maxSpins}, multiplier ${JSON.stringify(fc.multiplier)}`,
    );
    console.log(
      `    trigger 1 in ${f.frequency.toFixed(1)}, E[spins] ${f.expectedSpins.toFixed(2)}, E[win] ${f.averageWinStakes.toFixed(2)}× (SD ${f.sdWinStakes.toFixed(1)}×), P(feature pays 0) ${pct(f.pZero, 2)}, share ${pct(f.share, 1)} (${f.tier})`,
    );
    for (const r of f.byK) console.log(`    K=${r.k}: P ${r.pK.toExponential(3)}, ${r.spins} spins → E[spins] ${r.expectedSpins.toFixed(2)}, E[win] ${r.averageWinStakes.toFixed(2)}×`);
    console.log(`    buy price: ${f.buyPriceStakes !== null ? `${f.buyPriceStakes.toFixed(2)}× the stake (E[F | trigger] ÷ target RTP ${config.targetRtp})` : 'no buy offered'}`);
  }
  const r = stats.reach;
  console.log(`  Max-win reach: P(X ≥ ${stats.maxWinStakes}×) in [${r.lowerBound.toExponential(3)}, ${r.upperBound.toExponential(3)}] (${r.boundTier})${r.mc ? `, MC ${r.mc.hits} hits in ${r.mc.n?.toLocaleString('en-US')}` : ''}`);
  console.log(`  Session: mean ${stats.session.meanStakes.toFixed(1)}, median ${stats.session.medianStakes.toFixed(1)} stakes, P(bust) ${pct(stats.session.pBust, 1)} ± ${pct(stats.session.seBust, 1)}`);
  console.log('');
  console.log(`  Oracle: ${oracle.status.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL'} (${oracle.detail})`);
  for (const c of oracle.checks) console.log(`    ${c.ok ? 'ok  ' : 'FAIL'} ${c.name} (${c.file}): ${c.detail}`);

  const facts = buildSlotFacts({ game, specHash, featureSpecHash: featureHash, config, stats, oracle });
  const out = join(dir, 'slot-facts.json');
  if (!values['no-write']) {
    writeFileSync(out, JSON.stringify(facts, null, 2) + '\n', 'utf8');
    console.log(`  wrote ${out.startsWith(ROOT) ? out.slice(ROOT.length + 1) : out}`);
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s; MC ${rounds.toLocaleString('en-US')} rounds per conditional estimate, ${sessions.toLocaleString('en-US')} sessions, seed ${seed})`);

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
  console.log('\n  GATE PASS (oracle, RTP, hit rate, dry streak, max-win reachability)');
}

main().catch((e) => die((e as Error).stack ?? String(e)));
