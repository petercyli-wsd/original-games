// Commits one game's folder, and nothing else, even while other games are
// being committed in parallel: it uses `git commit --only <path>` and retries
// when another process holds the index or HEAD lock.
//
//   node scripts/commit-game.mjs <id> "<message>"

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [id, message] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');
if (!id || !message || !existsSync(join(root, 'games', id))) {
  console.error('Usage: node scripts/commit-game.mjs <game-id> "<message>"');
  process.exit(1);
}

const full = message.trim();
const path = `games/${id}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (let attempt = 1; ; attempt++) {
  try {
    git('add', '-A', '--', path);
    if (!git('status', '--porcelain', '--', path).trim()) {
      console.log(`Nothing to commit in ${path}`);
      process.exit(0);
    }
    git('commit', '--only', '-m', full, '--', path);
    console.log(git('log', '-1', '--format=%h %s').trim());
    process.exit(0);
  } catch (err) {
    const text = `${err.stderr ?? ''}${err.message ?? ''}`;
    if (attempt < 30 && /lock|unable to create|another git process/i.test(text)) {
      sleep(300 + Math.random() * 1500);
      continue;
    }
    console.error(text);
    process.exit(1);
  }
}
