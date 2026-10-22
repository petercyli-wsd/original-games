// Runs every game's Monte Carlo eval and checks it against the manifest.
//
//   npm run eval                      all games, 200k rounds per config
//   npm run eval -- --game template   one game
//   npm run eval -- --rounds 50000
//
// Exits non-zero if a game's measured RTP is more than 4 standard errors from
// its manifest RTP, or a payout exceeds its manifest maxMultiplier.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { formatMultiplier, formatPercent, runEval, type EvalSpec, type GameManifest } from '@originals/game-sdk';

const { values } = parseArgs({
  options: {
    game: { type: 'string' },
    rounds: { type: 'string', default: '200000' },
    seed: { type: 'string', default: '1' },
  },
});

const gamesDir = join(import.meta.dirname, '..', 'games');
const rounds = Number(values.rounds);
const seed = Number(values.seed);
let failures = 0;

const ids = readdirSync(gamesDir).filter((id) => !values.game || id === values.game);
if (ids.length === 0) {
  console.error(`No game found${values.game ? ` named "${values.game}"` : ''} in games/`);
  process.exit(1);
}

for (const id of ids) {
  const src = join(gamesDir, id, 'src');
  if (!existsSync(join(src, 'eval.ts'))) {
    console.warn(`⚠ ${id}: no src/eval.ts, skipped`);
    continue;
  }
  const load = async <T>(file: string) => ((await import(pathToFileURL(join(src, file)).href)) as { default: T }).default;
  const manifest = await load<GameManifest>('manifest.ts');
  const spec = await load<EvalSpec>('eval.ts');

  console.log(`\n${manifest.name} (${id}), target RTP ${formatPercent(manifest.rtp, 2)}, ${rounds.toLocaleString()} rounds/config`);
  const rows = runEval(spec, { rounds, seed }).map((r) => {
    const z = (r.rtp - (r.targetRtp ?? manifest.rtp)) / (r.stdError || Infinity);
    const ok = Math.abs(z) <= 4 && r.max <= manifest.maxMultiplier + 1e-9;
    if (!ok) failures++;
    return {
      config: r.label,
      rtp: formatPercent(r.rtp, 2),
      'z': z.toFixed(2),
      'hit rate': formatPercent(r.hitRate),
      'std dev': r.stdDev.toFixed(2),
      p50: formatMultiplier(r.p50),
      p99: formatMultiplier(r.p99),
      max: formatMultiplier(r.max),
      'avg steps': r.avgSteps.toFixed(1),
      ok: ok ? '✓' : '✗',
    };
  });
  console.table(rows);
}

if (failures) {
  console.error(`\n✗ ${failures} config(s) failed`);
  process.exit(1);
}
console.log('\n✓ All evals passed');
