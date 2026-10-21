// Scaffolds a new game from games/template.
//
//   npm run new-game -- <id> "<Display Name>"
//   npm run new-game -- shrinking-arc "Shrinking Arc"

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, name] = process.argv.slice(2);
if (!id || !name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error('Usage: npm run new-game -- <kebab-case-id> "<Display Name>"');
  process.exit(1);
}

const gamesDir = join(import.meta.dirname, '..', 'games');
const dest = join(gamesDir, id);
if (existsSync(dest)) {
  console.error(`games/${id} already exists`);
  process.exit(1);
}

cpSync(join(gamesDir, 'template'), dest, {
  recursive: true,
  filter: (src) => !/node_modules|dist/.test(src),
});

const edit = (file, replacements) => {
  const path = join(dest, file);
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`Template changed: "${from}" not found in ${file}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
};

edit('package.json', [['"@originals/game-template"', `"@originals/${id}"`]]);
edit('index.html', [['Arc Climb (standalone)', `${name} (standalone)`]]);
edit('src/manifest.ts', [
  ["id: 'template'", `id: '${id}'`],
  ["name: 'Arc Climb'", `name: ${JSON.stringify(name)}`],
  ["status: 'template'", "status: 'prototype'"],
]);

console.log(`Created games/${id}. Next:
  npm install                       # links the new workspace
  npm run dev -w @originals/${id}   # play it standalone
  npm run dev                       # or in the platform at /play/${id}
Then replace src/math.ts, src/eval.ts and src/Game.tsx with your game.`);
