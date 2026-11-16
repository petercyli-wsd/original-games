// slots:tune — tune a slot's pays (and optionally its strips) to the target RTP, exactly.
//
//   npm run slots:tune -- <id|dir> [--hit-rate 0.3] [--volatility low|medium|high|extreme] [--dry-run]
//
// <id> reads games/<id>/src/; a directory is used as given. Reads slot.spec.json, slot.config.json
// and the feature spec the config names; writes the specs back (unless --dry-run). The maths is in
// packages/slots/src/engine/analytics/tune.ts. The max-win cap is not counted here (slots:eval).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { SlotSpec } from '../../packages/slots/src/engine/types';
import { validateSlotConfig, type SlotConfig, type Volatility } from '../../packages/slots/src/engine/analytics/config';
import { tuneGame, type TuneMetrics } from '../../packages/slots/src/engine/analytics/tune';

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
    },
  });
  const target = positionals[0];
  if (!target) {
    console.error('usage: npm run slots:tune -- <id|dir> [--hit-rate <fraction>] [--volatility <low|medium|high|extreme>] [--dry-run]');
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
      console.error(`refused: ${e.message}\n(Monte Carlo specs can't be tuned exactly here.)`);
      process.exit(1);
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
    writeFileSync(specPath, JSON.stringify(r.base, null, indentOf(specText)) + (specText.endsWith('\n') ? '\n' : ''));
    console.log(`\nwrote ${specPath}`);
    if (featurePath && r.feature) {
      writeFileSync(featurePath, JSON.stringify(r.feature, null, indentOf(featureText)) + (featureText.endsWith('\n') ? '\n' : ''));
      console.log(`wrote ${featurePath}`);
    }
  }
  const id = target;
  console.log(`\nre-run npm run slots:oracle -- ${id} and npm run slots:eval -- ${id}`);
  if (!r.withinTolerance) process.exit(1);
}

main();
