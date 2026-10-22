// Builds one game's evidence pack: manifest, gameplay source, Monte Carlo
// eval and a hash of the code. Shared by scripts/evidence.ts (API build) and
// scripts/evaluator.ts (Claude Code reviews), so both judge identical inputs.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runEval, type EvalSpec, type GameManifest } from '@originals/game-sdk';

export const ROOT = join(import.meta.dirname, '..', '..');
export const GAMES_DIR = join(ROOT, 'games');

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

export const gameIds = () => readdirSync(GAMES_DIR).filter((id) => existsSync(join(GAMES_DIR, id, 'src', 'manifest.ts')));

export async function buildGameEvidence(id: string, rounds = 20000) {
  const src = join(GAMES_DIR, id, 'src');
  if (!existsSync(join(src, 'manifest.ts'))) throw new Error(`No game named "${id}" in games/`);
  const load = async <T>(file: string) => ((await import(pathToFileURL(join(src, file)).href)) as { default: T }).default;
  const manifest = await load<GameManifest>('manifest.ts');
  const files = sourceFiles(src)
    .map((path) => ({ path: relative(src, path).replaceAll('\\', '/'), content: readFileSync(path, 'utf8') }))
    .filter((f) => !SKIP.test(f.path));
  const codeHash = createHash('sha256')
    .update(files.map((f) => `${f.path}\n${f.content}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
  const evalReport = existsSync(join(src, 'eval.ts')) ? runEval(await load<EvalSpec>('eval.ts'), { rounds, seed: 1 }) : null;
  return { id, manifest, codeHash, files, eval: evalReport, rounds };
}
