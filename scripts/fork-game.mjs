// Starts a new version of a game whose team reviews must stay attached to the
// version they were written about: copies games/<id> to games/<new-id>, renames
// the copy, and archives the original (status 'retired', supersededBy the copy).
// The copy is then improved in place by /iterate-game.
//
//   node scripts/fork-game.mjs <id> [<new-id>]     (default new id: <id>-v2, or the next free -vN)
//   node scripts/fork-game.mjs <id> --keep         leaves the original as it is (archive it later,
//                                                  once the team prefers the copy)

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const [id, wanted] = args.filter((a) => a !== '--keep');
const games = join(root, 'games');
if (!id || !existsSync(join(games, id))) {
  console.error('Usage: node scripts/fork-game.mjs <game-id> [<new-id>]');
  process.exit(1);
}

const base = id.replace(/-v\d+$/, '');
let next = wanted;
for (let n = 2; !next || existsSync(join(games, next)); n++) next = `${base}-v${n}`;
if (wanted && wanted !== next) {
  console.error(`games/${wanted} already exists`);
  process.exit(1);
}

cpSync(join(games, id), join(games, next), { recursive: true, filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(src) });

const edit = (file, fn) => {
  const path = join(games, file);
  if (existsSync(path)) writeFileSync(path, fn(readFileSync(path, 'utf8')));
};
const idLine = /(\bid:\s*)(['"])[^'"]+\2/;
edit(`${next}/package.json`, (s) => s.replace(`"@originals/${id}"`, `"@originals/${next}"`));
edit(`${next}/src/manifest.ts`, (s) => s.replace(idLine, `$1$2${next}$2`).replace(/\n\s*supersededBy:[^\n]*/, ''));
if (!keep) {
  edit(`${id}/src/manifest.ts`, (s) =>
    s.replace(/status:\s*(['"])\w+\1/, `status: $1retired$1`).replace(/(\n)(\s*)(status:[^\n]*\n)/, `$1$2$3$2supersededBy: '${next}',\n`),
  );
}

console.log(`✓ games/${next} created from games/${id}; ${keep ? `games/${id} left as it is` : `games/${id} archived (status retired, supersededBy '${next}')`}.`);
console.log('Next: npm install --package-lock-only --ignore-scripts (the new workspace must be in package-lock.json, or the deploy fails).');
