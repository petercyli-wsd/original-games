// Exact stats of the written specs (slow: enumerates every reveal component). npx tsx games/unfold/tools/stats.ts
// Writes ../src/slot-facts.json when --write is given.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSlotStats } from '../../../packages/slots/src/engine/analytics/stats';
import { mixtureDist, mixtureRtp } from '../src/mixture';
const SRC = join(import.meta.dirname, '..', 'src');
const rd = (f: string) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
const spec = rd('slot.spec.json'), fspec = rd('feature.spec.json'), config = rd('slot.config.json');
const t0 = Date.now();
const baseDist = mixtureDist(spec);
console.error('base dist', baseDist.p.length, 'entries', (Date.now() - t0) / 1000, 's');
const featureDist = mixtureDist(fspec);
console.error('feature dist', featureDist.p.length, 'entries', (Date.now() - t0) / 1000, 's');
const baseRtp = { rtp: mixtureRtp(spec), tier: 'exact_mixture' as const };
const stats = computeSlotStats({ spec, featureSpec: fspec, config, baseDist, featureDist, baseRtp });
writeFileSync(join(import.meta.dirname, 'stats.json'), JSON.stringify(stats, null, 1));
for (const r of stats.rows) console.log(r.label.padEnd(34), r.display.padEnd(28), r.band?.text ?? '', r.pass === null ? '' : r.pass ? 'PASS' : 'FAIL');
console.log('failed', stats.bandsFailed, stats.gateFailed);
