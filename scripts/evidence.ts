// Builds the evidence the AI evaluator judges: one JSON file per game with its
// manifest, gameplay source, Monte Carlo eval stats and a hash of the code.
// Runs as part of the API build, so the deployed API always reviews the code
// it was built from.
//
//   npm run evidence                     all games, 20k rounds per config
//   npm run evidence -- --game drift     one game
//   npm run evidence -- --rounds 5000

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runEval, type EvalSpec, type GameManifest } from '@originals/game-sdk';

const { values } = parseArgs({
  options: {
    game: { type: 'string' },
    rounds: { type: 'string', default: '20000' },
    out: { type: 'string' },
  },
});

const root = join(import.meta.dirname, '..');
const gamesDir = join(root, 'games');
const outDir = values.out ?? join(root, 'apps', 'api', 'evidence');
const rounds = Number(values.rounds);

// Gameplay code only: tests, styles and dev entry points are noise for a judge.
const SKIP = /(\.test\.tsx?|\.css|(^|\/)dev\.ts|(^|\/)index\.ts)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
}

mkdirSync(outDir, { recursive: true });
const ids = readdirSync(gamesDir).filter((id) => (values.game ? id === values.game : existsSync(join(gamesDir, id, 'src', 'manifest.ts'))));
let failed = 0;

for (const id of ids) {
  const src = join(gamesDir, id, 'src');
  const started = Date.now();
  try {
    const load = async <T>(file: string) => ((await import(pathToFileURL(join(src, file)).href)) as { default: T }).default;
    const manifest = await load<GameManifest>('manifest.ts');
    const files = sourceFiles(src)
      .map((path) => ({ path: relative(src, path).replaceAll('\\', '/'), content: readFileSync(path, 'utf8') }))
      .filter((f) => !SKIP.test(f.path));
    const codeHash = createHash('sha256')
      .update(files.map((f) => `${f.path}\n${f.content}`).join('\n'))
      .digest('hex')
      .slice(0, 16);

    let evalReport: unknown = null;
    if (existsSync(join(src, 'eval.ts'))) {
      const spec = await load<EvalSpec>('eval.ts');
      evalReport = runEval(spec, { rounds, seed: 1 });
    }

    writeFileSync(join(outDir, `${id}.json`), JSON.stringify({ id, manifest, codeHash, files, eval: evalReport, rounds }));
    console.log(`✓ ${id} (${files.length} files, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${id}:`, err instanceof Error ? err.message : err);
  }
}

console.log(`\nEvidence for ${ids.length - failed}/${ids.length} games in ${relative(root, outDir)}`);
// A broken game shouldn't stop the API deploying; it just can't be reviewed.
