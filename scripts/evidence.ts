// Builds the evidence the AI evaluator judges: one JSON file per game with its
// manifest, gameplay source, Monte Carlo eval stats and a hash of the code.
// Runs as part of the API build, so the deployed API always reviews the code
// it was built from.
//
//   npm run evidence                     all games, 20k rounds per config
//   npm run evidence -- --game drift     one game
//   npm run evidence -- --rounds 5000

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, buildGameEvidence, gameIds } from './lib/game-evidence';

const { values } = parseArgs({
  options: {
    game: { type: 'string' },
    rounds: { type: 'string', default: '20000' },
    out: { type: 'string' },
  },
});

const outDir = values.out ?? join(ROOT, 'apps', 'api', 'evidence');
const ids = values.game ? [values.game] : gameIds();
mkdirSync(outDir, { recursive: true });
let failed = 0;

for (const id of ids) {
  const started = Date.now();
  try {
    const evidence = await buildGameEvidence(id, Number(values.rounds));
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(evidence));
    console.log(`✓ ${id} (${evidence.files.length} files, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${id}:`, err instanceof Error ? err.message : err);
  }
}

console.log(`\nEvidence for ${ids.length - failed}/${ids.length} games in ${relative(ROOT, outDir)}`);
// A broken game shouldn't stop the API deploying; it just can't be reviewed.
