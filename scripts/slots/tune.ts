// slots:tune — tune a slot's pays (and optionally its strips) to the target RTP, exactly.
//
//   npm run slots:tune -- <id|dir> [--hit-rate 0.3] [--volatility low|medium|high|extreme] [--dry-run]
//                                  [--out <dir>]   (write the tuned specs there instead of over the game's)
//                                  [--budget-s 300] [--rtp-se 0.001]   (passed to slots:eval for specs with no TS closed form)
//
// <id> reads games/<id>/src/; a directory is used as given. Reads slot.spec.json, slot.config.json
// and the feature spec the config names; writes the specs back (unless --dry-run). The maths is in
// packages/slots/src/engine/analytics/tune.ts. The max-win cap is not counted here (slots:eval).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { SlotSpec } from '../../packages/slots/src/engine/types';
import { validateSlotConfig, type SlotConfig, type Volatility } from '../../packages/slots/src/engine/analytics/config';
import { tuneGame, type TuneMetrics } from '../../packages/slots/src/engine/analytics/tune';
import { SlotEngine } from '../../packages/slots/src/engine/engine';
import { Mulberry32 } from '../../packages/slots/src/engine/rng';

const ROOT = resolve(import.meta.dirname, '..', '..');

function indentOf(text: string): string | number {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1] : 2;
}

function fmtPct(x: number, d = 4): string {
  return `${(x * 100).toFixed(d)}%`;
}

function row(label: string, b: string, a: string): string {
  return `  ${label.padEnd(26)} ${b.padStart(16)}  ->  ${a}`;
}

function table(before: TuneMetrics, after: TuneMetrics): string[] {
  const one = (n: number) => (Number.isFinite(n) ? `1 in ${n.toFixed(1)}` : 'none');
  const x = (n: number) => (Number.isFinite(n) ? `${n.toFixed(2)}x` : 'n/a');
  return [
    row('total RTP', `${fmtPct(before.totalRtp)} ${before.tier}`, `${fmtPct(after.totalRtp)} ${after.tier}`),
    row('base RTP', fmtPct(before.baseRtp), fmtPct(after.baseRtp)),
    row('feature RTP', fmtPct(before.featureRtp), fmtPct(after.featureRtp)),
    row('feature share', fmtPct(before.featureShare, 1), fmtPct(after.featureShare, 1)),
    row('hit rate (round)', fmtPct(before.hitRate, 2), fmtPct(after.hitRate, 2)),
    row('hit rate (base spin)', fmtPct(before.baseHitRate, 2), fmtPct(after.baseHitRate, 2)),
    row('SD per spin (stakes)', before.sdStakes.toFixed(2), after.sdStakes.toFixed(2)),
    row('feature frequency', one(before.featureFrequency), one(after.featureFrequency)),
    row('average feature win', x(before.averageFeatureWin), x(after.averageFeatureWin)),
  ];
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'hit-rate': { type: 'string' },
      volatility: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      out: { type: 'string' },
      'budget-s': { type: 'string' },
      'rtp-se': { type: 'string' },
    },
  });
  const target = positionals[0];
  if (!target) {
    console.error('usage: npm run slots:tune -- <id|dir> [--hit-rate <fraction>] [--volatility <low|medium|high|extreme>] [--dry-run] [--out <dir>] [--budget-s N] [--rtp-se X]');
    process.exit(2);
  }
  const dir = existsSync(resolve(target)) && !existsSync(join(ROOT, 'games', target, 'src')) ? resolve(target) : join(ROOT, 'games', target, 'src');
  if (!existsSync(join(dir, 'slot.spec.json'))) {
    console.error(`no slot.spec.json in ${dir}`);
    process.exit(2);
  }
  const hitRate = values['hit-rate'] !== undefined ? Number(values['hit-rate']) : undefined;
  if (hitRate !== undefined && !(hitRate > 0 && hitRate < 1)) {
    console.error('--hit-rate must be a fraction in (0, 1)');
    process.exit(2);
  }
  const volatility = values.volatility as Volatility | undefined;
  if (volatility !== undefined && !['low', 'medium', 'high', 'extreme'].includes(volatility)) {
    console.error('--volatility must be low, medium, high or extreme');
    process.exit(2);
  }

  const specPath = join(dir, 'slot.spec.json');
  const specText = readFileSync(specPath, 'utf8');
  const spec = JSON.parse(specText) as SlotSpec;
  const config = JSON.parse(readFileSync(join(dir, 'slot.config.json'), 'utf8')) as SlotConfig;
  const problems = validateSlotConfig(config);
  if (problems.length) {
    console.error(`slot.config.json: ${problems.join('; ')}`);
    process.exit(1);
  }
  let featurePath: string | null = null;
  let featureText = '';
  let featureSpec: SlotSpec | null = null;
  if (config.feature) {
    featurePath = join(dir, config.feature.spec);
    featureText = readFileSync(featurePath, 'utf8');
    featureSpec = JSON.parse(featureText) as SlotSpec;
  }

  console.log(`slots:tune ${basename(dir === join(ROOT, 'games', target, 'src') ? target : dir)}  target ${fmtPct(config.targetRtp, 2)} (tolerance +-0.05 percentage points, max win not counted)`);
  let r;
  try {
    r = tuneGame(spec, featureSpec, config.feature ?? null, config.targetRtp, {
      hitRate,
      volatility,
      log: (l) => console.log(`  ${l}`),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'NoClosedForm') {
      if (hitRate !== undefined || volatility !== undefined) {
        console.error(`refused: ${e.message}\n(--hit-rate / --volatility need a TypeScript closed form; this spec is tuned by its pays only.)`);
        process.exit(1);
      }
      console.log(`  no TypeScript closed form (${e.message}): tuning by the linear pay scale, verified by slots:eval`);
      const ok = tuneByScale({ dir, target, spec, specText, specPath, featureSpec, featureText, featurePath, config, dryRun: !!values['dry-run'], outDir: values.out ? resolve(values.out) : null, evalArgs: [values['budget-s'] ? `--budget-s ${values['budget-s']}` : '', values['rtp-se'] ? `--rtp-se ${values['rtp-se']}` : ''].join(' ') });
      process.exit(ok ? 0 : 1);
    }
    throw e;
  }

  console.log('');
  for (const l of table(r.before, r.after)) console.log(l);
  console.log('');
  for (const n of r.notes) console.log(`  note: ${n}`);
  if (r.stripEdits) console.log(`  strips: ${r.stripEdits} stop edits (scatter and wild stops untouched)`);
  console.log(
    `  RTP error ${(r.error * 100).toFixed(5)} percentage points: ${r.withinTolerance ? 'inside' : 'OUTSIDE'} the +-0.05 band`,
  );
  console.log(`\n  pay changes (${r.payChanges.length}):`);
  for (const c of r.payChanges) console.log(`    ${c.label.padEnd(18)} ${String(c.before).padStart(7)} -> ${c.after}`);

  if (values['dry-run']) console.log('\n--dry-run: nothing written.');
  else {
    const outDir = values.out ? resolve(values.out) : null;
    if (outDir) mkdirSync(outDir, { recursive: true });
    const specOut = outDir ? join(outDir, basename(specPath)) : specPath;
    writeFileSync(specOut, JSON.stringify(r.base, null, indentOf(specText)) + (specText.endsWith('\n') ? '\n' : ''));
    console.log(`\nwrote ${specOut}`);
    if (featurePath && r.feature) {
      const featOut = outDir ? join(outDir, basename(featurePath)) : featurePath;
      writeFileSync(featOut, JSON.stringify(r.feature, null, indentOf(featureText)) + (featureText.endsWith('\n') ? '\n' : ''));
      console.log(`wrote ${featOut}`);
    }
  }
  const id = target;
  console.log(`\nre-run npm run slots:oracle -- ${id} and npm run slots:eval -- ${id}`);
  if (!r.withinTolerance) process.exit(1);
}

// --------------------------------------------------------------------------- no TS closed form
//
// Specs whose RTP has no TypeScript closed form (tumbles, cascades, cluster, respins, hold-and-spin,
// heights …) are tuned by the pays' linear scale:
//
//   ASSUMPTION (no max-win cap): every coin a spin pays is either proportional to the paytable
//   (line / ways / count pays, scatter pays, wild own pays, and anything multiplied from them:
//   cascade ladders, global multipliers, free-spin multipliers) or independent of it (e.g.
//   hold-and-spin coin values in coins). Board evolution never depends on pay AMOUNTS (only on
//   which symbols win). Then RTP(s · pays) = R1 + (s − 1) · L, with L the pay-proportional part.
//
// L is measured per spec with common random numbers: the same seeds spun at pays P and 2P give,
// spin by spin, the proportional part c(2P) − c(P) exactly. The same seeds at 3P TEST the
// assumption: c(3P) − 2c(2P) + c(P) must be 0 on every spin (integer coins), else we refuse with
// the count of non-linear spins. R1 and the split base / feature come from slots:eval (pack
// anchored where the pack is exact, else the worker Monte Carlo with its SE). The feature RTP
// is linear in the feature spin's mean win, so L_total = ρ_base · base RTP + ρ_feature · feature RTP
// with ρ = L / mean coins per spec. Integer rounding moves each trial's pay-proportional coins off
// s by up to ~0.1%, so each trial's EFFECTIVE scale (base and feature) is measured with the same
// common random numbers. Every trial is evaluated by slots:eval on its own seed, and the estimates
// are pooled through the linear model (R_i = N + rB_i·LB + rF_i·LF, inverse-variance weights), so
// the iteration converges on the pooled N instead of chasing one eval's noise; the final pays are
// solved against the pooled N and reported with the pooled SE. Up to 3 trial evals; stop early
// when the pooled prediction is within ±0.0005 with SE ≤ 0.00025.
// Accept |R − target| ≤ 0.0005,
// R being the CAPPED RTP slots:eval reports (the cap loss isn't linear in the pays, the iteration absorbs it),
// or ≤ 3 SE when the verifying RTP is Monte Carlo. The pack oracle is regenerated for the trial
// specs when the game's oracle was exact, so an exact pack RTP stays exact.

const PACK = process.env.SLOT_ENGINE_PACK || '/Users/petercyli-wsd/Dev/slot-math-engine-pack';
const CRN_SPINS = 100_000;

type Pays = SlotSpec['pays'];

/**
 * Every pay entry of a spec × s, rounded to integer coins (≥ 1 where it was ≥ 1). Rounding is
 * monotone, so the pay order in count and across symbols is kept, and equal pays stay equal
 * (paytables often have deliberate plateaus, e.g. 8 and 9 of a kind paying the same).
 * `fine` multiplies, on top, only the pays that reach `big` coins after scaling: a large pay rounds
 * almost continuously (1 coin ≤ 1/big), so it fine-tunes what the small pays' rounding steps can't
 * reach. Callers check the pay order (`keepsOrder`) when fine ≠ 1.
 */
export function scalePays(spec: SlotSpec, s: number, fine = 1, big = Infinity): SlotSpec {
  const out = JSON.parse(JSON.stringify(spec)) as SlotSpec;
  const scaleMap = (m: Record<string, number> | undefined) => {
    if (!m) return;
    for (const k of Object.keys(m))
      if (m[k]) {
        const x = m[k] * s;
        m[k] = Math.max(1, Math.round(x >= big ? x * fine : x));
      }
  };
  const p = out.pays as Pays;
  for (const tbl of Object.values(p.paytable)) scaleMap(tbl);
  scaleMap(p.scatter_pay);
  const ev = out.evaluation as Record<string, unknown>;
  scaleMap(ev.wild_own_pay as Record<string, number> | undefined);
  return out;
}

/** Does `after` keep every weak order of `before`'s pays (by count per symbol, across symbols at a count, ties kept)? */
export function keepsOrder(before: SlotSpec, after: SlotSpec): boolean {
  const flat = (sp: SlotSpec) => {
    const out: { key: string; sym: string; n: string; v: number }[] = [];
    for (const [sym, t] of Object.entries(sp.pays.paytable)) for (const [n, v] of Object.entries(t)) out.push({ key: `p|${sym}|${n}`, sym: `p|${sym}`, n: `p|${n}`, v });
    for (const [n, v] of Object.entries(sp.pays.scatter_pay ?? {})) out.push({ key: `s|${n}`, sym: 's', n: `s|${n}`, v });
    return out;
  };
  const b = flat(before);
  const a = new Map(flat(after).map((e) => [e.key, e.v]));
  for (const x of b)
    for (const y of b) {
      if (x.sym !== y.sym && x.n !== y.n) continue;
      const ax = a.get(x.key)!;
      const ay = a.get(y.key)!;
      if (x.v > y.v && ax < ay) return false;
      if (x.v === y.v && ax !== ay) return false;
    }
  return true;
}

/** The pay-proportional share ρ = E[c(2P) − c(P)] / E[c(P)] of a spec, and the linearity test. */
function linearShare(spec: SlotSpec, n: number): { rho: number; nonLinear: number; mean: number } {
  const e1 = new SlotEngine(spec);
  const e2 = new SlotEngine(scalePaysExact(spec, 2));
  const e3 = new SlotEngine(scalePaysExact(spec, 3));
  let s1 = 0;
  let sl = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const seed = (0x9e3779b9 * (i + 1)) >>> 0;
    const c1 = e1.spinRaw(new Mulberry32(seed)).totalCoins;
    const c2 = e2.spinRaw(new Mulberry32(seed)).totalCoins;
    const c3 = e3.spinRaw(new Mulberry32(seed)).totalCoins;
    s1 += c1;
    sl += c2 - c1;
    if (c3 - 2 * c2 + c1 !== 0) bad++;
  }
  return { rho: s1 > 0 ? sl / s1 : 0, nonLinear: bad, mean: s1 / n };
}

/** Mean coins per spin over the fixed CRN seeds (the same seeds linearShare uses). */
function meanCoins(spec: SlotSpec, n: number): number {
  const e = new SlotEngine(spec);
  let s = 0;
  for (let i = 0; i < n; i++) s += e.spinRaw(new Mulberry32((0x9e3779b9 * (i + 1)) >>> 0)).totalCoins;
  return s / n;
}

/** Pays × an integer factor, exactly (for the common-random-numbers measurement). */
function scalePaysExact(spec: SlotSpec, k: number): SlotSpec {
  const out = JSON.parse(JSON.stringify(spec)) as SlotSpec;
  const mul = (m: Record<string, number> | undefined) => {
    if (m) for (const key of Object.keys(m)) m[key] = m[key] * k;
  };
  for (const tbl of Object.values(out.pays.paytable)) mul(tbl);
  mul(out.pays.scatter_pay);
  mul((out.evaluation as Record<string, unknown>).wild_own_pay as Record<string, number> | undefined);
  return out;
}

interface EvalRead {
  rtp: number;
  tier: string;
  se: number;
  base: number;
  feature: number;
  ok: boolean;
  log: string;
}

/** Run slots:eval on a directory and read its slot-facts.json: the CAPPED RTP (a large cap loss, e.g. 0.3% on an
 * extreme tumble game, is part of what must land on target), with its SE. */
function runEval(dir: string, extra: string): EvalRead {
  const args = ['tsx', join(ROOT, 'scripts', 'slots', 'eval.ts'), dir, ...extra.split(/\s+/).filter(Boolean)];
  const r = spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const factsPath = join(dir, 'slot-facts.json');
  if (!existsSync(factsPath)) throw new Error(`slots:eval wrote no slot-facts.json:\n${r.stdout}\n${r.stderr}`);
  const f = JSON.parse(readFileSync(factsPath, 'utf8')) as {
    rtp: number;
    rtpTier: string;
    rtpSe: number;
    rtpSplit: { base: number; feature: number };
  };
  rmSync(factsPath);
  return {
    rtp: f.rtp,
    tier: f.rtpTier,
    se: f.rtpSe ?? 0,
    base: f.rtpSplit.base,
    feature: f.rtpSplit.feature,
    ok: r.status === 0,
    log: r.stdout,
  };
}

/** Write the pack oracle (game format) for the specs in a trial directory. */
function packOracle(dir: string, featureFile: string | null): boolean {
  const py = join(PACK, '.venv', 'bin', 'python');
  if (!existsSync(py)) return false;
  const code = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(join(ROOT, 'scripts', 'slots'))})`,
    'import oracle',
    `d = ${JSON.stringify(dir)}`,
    `ff = ${JSON.stringify(featureFile)}`,
    "doc = {'schema': oracle.SCHEMA, 'packVersion': oracle.pack_version(), 'game': 'tune-trial'}",
    "spec = json.load(open(d + '/slot.spec.json'))",
    "doc['base'] = {'file': 'slot.spec.json', **oracle.oracle_entry(spec, seeds=1, with_analytics=True, slug='tune-trial')}",
    "doc['features'] = {}",
    'if ff:',
    "    fs = json.load(open(d + '/' + ff))",
    "    doc['features'][ff[:-len('.spec.json')] if ff.endswith('.spec.json') else ff] = {'file': ff, **oracle.oracle_entry(fs, seeds=1, with_analytics=True, slug='tune-trial-feature')}",
    "json.dump(doc, open(d + '/oracle.json', 'w'))",
  ].join('\n');
  const r = spawnSync(py, ['-c', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, SLOT_ENGINE_PACK: PACK, PYTHONPATH: join(PACK, 'src'), PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (r.status !== 0) console.log(`  (pack oracle for the trial specs failed: ${r.stderr.trim().split('\n').pop()})`);
  return r.status === 0;
}

interface ScaleArgs {
  dir: string;
  target: string;
  spec: SlotSpec;
  specText: string;
  specPath: string;
  featureSpec: SlotSpec | null;
  featureText: string;
  featurePath: string | null;
  config: SlotConfig;
  dryRun: boolean;
  /** Write the tuned specs here instead of over the game's own (for a reviewer to apply). */
  outDir: string | null;
  evalArgs: string;
}

function tuneByScale(a: ScaleArgs): boolean {
  const target = a.config.targetRtp;
  const featureFile = a.config.feature?.spec ?? null;
  // was the game's oracle exact? then regenerate it for every trial so the pack stays the authority
  let packExact = false;
  const oraclePath = join(a.dir, 'oracle.json');
  if (existsSync(oraclePath)) {
    const o = JSON.parse(readFileSync(oraclePath, 'utf8')) as { base?: { analytics?: { tier?: string } } };
    packExact = ['exact', 'exact_mixture'].includes(o.base?.analytics?.tier ?? '');
  }
  console.log(`  pays scale linearly (assumption, tested): common random numbers over ${CRN_SPINS.toLocaleString('en-US')} spins per spec at pays ×1, ×2, ×3`);
  const lb = linearShare(a.spec, CRN_SPINS);
  const lf = a.featureSpec ? linearShare(a.featureSpec, CRN_SPINS) : null;
  for (const [name, l] of [['base', lb], ['feature', lf]] as const) {
    if (!l) continue;
    console.log(`    ${name}: pay-proportional share ρ = ${(l.rho * 100).toFixed(3)}% of its coins; non-linear spins ${l.nonLinear}`);
    if (l.nonLinear > 0) {
      console.error(`refused: ${l.nonLinear} ${name} spins pay non-linearly in the pays (a mechanic reads win amounts), so a pay scale can't be solved here`);
      return false;
    }
  }

  const trial = mkdtempSync(join(tmpdir(), 'slots-tune-'));
  const writeTrial = (base: SlotSpec, feat: SlotSpec | null) => {
    writeFileSync(join(trial, 'slot.spec.json'), JSON.stringify(base, null, 1) + '\n');
    if (feat && featureFile) writeFileSync(join(trial, featureFile), JSON.stringify(feat, null, 1) + '\n');
    copyFileSync(join(a.dir, 'slot.config.json'), join(trial, 'slot.config.json'));
    if (packExact) packOracle(trial, featureFile);
    else if (existsSync(join(trial, 'oracle.json'))) rmSync(join(trial, 'oracle.json'));
  };
  const fmt = (r: EvalRead) => `${(r.rtp * 100).toFixed(4)}% ${r.tier}${r.tier === 'mc' ? ` ± ${(r.se * 100).toFixed(4)}%` : ''} (base ${(r.base * 100).toFixed(3)}% + feature ${(r.feature * 100).toFixed(3)}%)`;
  const inside = (r: EvalRead) => Math.abs(r.rtp - target) <= 0.0005;
  const withinNoise = (r: EvalRead) => r.tier === 'mc' && Math.abs(r.rtp - target) <= 3 * r.se;

  try {
    // every trial eval runs on its own seed, so the estimates are independent and can be pooled
    const evalAt = (i: number) => runEval(trial, `${a.evalArgs} --seed ${20261116 + 7919 * i}`);
    writeTrial(a.spec, a.featureSpec);
    const before = evalAt(0);
    console.log(`  before: ${fmt(before)}`);
    // R = N + rB·LB + rF·LF: LB, LF the pay-proportional RTP of base and feature at the current pays
    // (ρ measured at scale 1); rB, rF the EFFECTIVE scale of a trial spec's pay-proportional coins,
    // measured with common random numbers (integer rounding moves it off s by up to ~0.1%).
    const LB = lb.rho * before.base;
    const LF = lf ? lf.rho * before.feature : 0;
    const L1 = LB + LF;
    if (!(L1 > 0)) {
      console.error('refused: no pay-proportional RTP to scale');
      return false;
    }
    console.log(`  pay-proportional RTP ${(L1 * 100).toFixed(3)}% of ${(before.rtp * 100).toFixed(3)}%; the rest (${((before.rtp - L1) * 100).toFixed(3)}%) doesn't scale with the pays (cap loss included)`);
    const m0 = new Map<SlotSpec, number>();
    const effScale = (spec0: SlotSpec, spec1: SlotSpec, rho: number) => {
      if (!m0.has(spec0)) m0.set(spec0, meanCoins(spec0, CRN_SPINS));
      const m = m0.get(spec0)!;
      return (meanCoins(spec1, CRN_SPINS) - (1 - rho) * m) / (rho * m);
    };
    interface Trial { s: number; fine: number; rB: number; rF: number; base: SlotSpec; feat: SlotSpec | null }
    const BIG = 2000; // coins: a 1-coin rounding step is ≤ 0.05% of such a pay
    const trialAt = (sc: number, fine = 1): Trial | null => {
      const base = scalePays(a.spec, sc, fine, BIG);
      const feat = a.featureSpec ? scalePays(a.featureSpec, sc, fine, BIG) : null;
      if (fine !== 1 && (!keepsOrder(a.spec, base) || (feat && !keepsOrder(a.featureSpec!, feat)))) return null;
      return { s: sc, fine, base, feat, rB: lb.rho > 0 ? effScale(a.spec, base, lb.rho) : 1, rF: feat && lf && lf.rho > 0 ? effScale(a.featureSpec!, feat, lf.rho) : 1 };
    };
    const lin = (t: Trial) => t.rB * LB + t.rF * LF;
    // pooled N over every eval (inverse-variance weights; an exact eval pins it)
    const points: { t: Trial; r: EvalRead }[] = [{ t: { s: 1, fine: 1, rB: 1, rF: 1, base: a.spec, feat: a.featureSpec }, r: before }];
    const pooled = () => {
      let sw = 0;
      let swn = 0;
      for (const { t, r } of points) {
        const w = 1 / Math.max(r.tier === 'mc' ? r.se : 0, 1e-9) ** 2;
        sw += w;
        swn += w * (r.rtp - lin(t));
      }
      return { N: swn / sw, se: points.some((q) => q.r.tier !== 'mc') ? 0 : 1 / Math.sqrt(sw) };
    };
    // the trial whose predicted RTP is on target. The effective scale r(s) is a STEP function of s
    // (frequent small pays round in jumps: 50 coins becomes 51 only from s ≥ 1.01), so a secant
    // iteration can land anywhere; search a grid of s around the linear estimate instead (each
    // candidate's effective scale measured by the cached common random numbers) and keep the
    // candidate whose prediction is closest to target (ties: closest to the estimate).
    const trialCache = new Map<string, Trial | null>();
    const trialCached = (sc: number, fine = 1) => {
      const key = `${Math.round(sc * 1e6)}|${Math.round(fine * 1e6)}`;
      if (!trialCache.has(key)) trialCache.set(key, trialAt(Math.round(sc * 1e6) / 1e6, Math.round(fine * 1e6) / 1e6));
      return trialCache.get(key)!;
    };
    const solve = (N: number): Trial => {
      const s0 = (target - N) / L1;
      const errOf = (t: Trial) => Math.abs(N + lin(t) - target);
      // 1. the global scale, on a grid around the linear estimate
      let best: Trial | null = null;
      for (let d = -16; d <= 16; d++) {
        const t = trialCached(s0 + d * 0.00025);
        if (t && (!best || errOf(t) < errOf(best) - 1e-12)) best = t;
      }
      // 2. the large pays' fine factor, where the small pays' rounding steps leave a gap
      if (best && errOf(best) > 0.0001) {
        const probe = trialCached(best.s, 1.01);
        const slope = probe ? (lin(probe) - lin(best)) / 0.01 : 0;
        if (slope > 1e-6) {
          const f0 = 1 + (target - N - lin(best)) / slope;
          for (let d = -4; d <= 4; d++) {
            const t = trialCached(best.s, f0 + d * 0.0002);
            if (t && errOf(t) < errOf(best) - 1e-12) best = t;
          }
        }
      }
      return best!;
    };
    let pick = points[0].t;
    for (let it = 1; it <= 3; it++) {
      const P = pooled();
      const predNow = P.N + lin(pick);
      if (Math.abs(predNow - target) <= 0.0005 && P.se <= 0.0005 / 2) break;
      const t = solve(P.N);
      const r = (writeTrial(t.base, t.feat), evalAt(it));
      points.push({ t, r });
      pick = t;
      const Q = pooled();
      console.log(`  scale ×${t.s.toFixed(6)}${t.fine !== 1 ? `, pays ≥ ${BIG} coins ×${t.fine.toFixed(5)} more` : ''} (effective ×${t.rB.toFixed(5)} base, ×${t.rF.toFixed(5)} feature): this eval ${fmt(r)}; pooled over ${points.length} evals ${((Q.N + lin(t)) * 100).toFixed(4)}% ± ${(Q.se * 100).toFixed(4)}%`);
    }
    // the final pays: on target under the pooled estimate
    const P = pooled();
    if (points.length > 1) pick = solve(P.N);
    const pred = P.N + lin(pick);
    const final: EvalRead = { rtp: pred, tier: P.se > 0 ? 'mc' : before.tier, se: P.se, base: NaN, feature: NaN, ok: true, log: '' };
    const best = { s: pick.s, fine: pick.fine, r: final, base: pick.base, feat: pick.feat };
    const ok = inside(best.r) || withinNoise(best.r);
    console.log('');
    console.log(row('total RTP (capped)', fmt(before).split(' (')[0], `${fmt(final).split(' (')[0]} (pooled over ${points.length} evals at their effective scales)`));
    console.log(
      `  RTP error ${((best.r.rtp - target) * 100).toFixed(4)} percentage points: ${inside(best.r) ? 'inside the ±0.05 pp band' : withinNoise(best.r) ? `within noise (outside ±0.05 pp but within 3 SE = ${(3 * best.r.se * 100).toFixed(3)} pp; more --budget-s narrows it)` : 'OUTSIDE the ±0.05 pp band'}; capped RTP (slots:eval's, cap loss included)`,
    );
    if (best.s === 1 && best.fine === 1) console.log('  pays unchanged (already on target).');
    else if (a.dryRun) console.log('\n--dry-run: nothing written.');
    else {
      const specOut = a.outDir ? join(a.outDir, basename(a.specPath)) : a.specPath;
      if (a.outDir) mkdirSync(a.outDir, { recursive: true });
      writeFileSync(specOut, JSON.stringify(best.base, null, indentOf(a.specText)) + (a.specText.endsWith('\n') ? '\n' : ''));
      console.log(`\nwrote ${specOut}`);
      if (a.featurePath && best.feat) {
        const featOut = a.outDir ? join(a.outDir, basename(a.featurePath)) : a.featurePath;
        writeFileSync(featOut, JSON.stringify(best.feat, null, indentOf(a.featureText)) + (a.featureText.endsWith('\n') ? '\n' : ''));
        console.log(`wrote ${featOut}`);
      }
      console.log(`  pay scale ×${best.s.toFixed(6)} on every paytable / scatter / wild-own pay of both specs${best.fine !== 1 ? `, then ×${best.fine.toFixed(5)} on the pays ≥ ${BIG} coins` : ''} (rounded to integer coins; pay order and plateaus kept)`);
    }
    console.log(`\nre-run npm run slots:oracle -- ${a.target} and npm run slots:eval -- ${a.target}`);
    return ok;
  } finally {
    rmSync(trial, { recursive: true, force: true });
  }
}

main();
