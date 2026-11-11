// Read-only view of the team's reviews for /search-games. Never writes to the API.
//
//   node .claude/skills/search-games/team-feed.mjs              new reviews since the last run (then marks them seen)
//   node .claude/skills/search-games/team-feed.mjs --peek       the same, without marking them seen
//   node .claude/skills/search-games/team-feed.mjs --ratings <id...>   team average and count per game

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..', '..');
process.loadEnvFile(join(root, '.env.local'));
const base = process.env.ORIGINALS_API_URL.trim().replace(/\/+$/, '');
const get = async (path) => {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
};

const args = process.argv.slice(2);
const ratings = await get('/ratings');

if (args[0] === '--ratings') {
  for (const id of args.slice(1)) {
    const r = ratings[id];
    console.log(`${id}: ${r ? `${r.average.toFixed(2)} from ${r.count}` : 'not rated'}`);
  }
  process.exit(0);
}

const dir = join(root, '.evaluator', '_search');
const seenFile = join(dir, 'seen-reviews.json');
mkdirSync(dir, { recursive: true });
const seen = new Set(existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : []);
const key = (r) => `${r.gameId}|${r.reviewer ?? ''}|${r.updatedAt}`;

const fresh = (await get('/reviews')).filter((r) => !seen.has(key(r)));
if (!fresh.length) console.log('No new team reviews.');
for (const r of fresh) {
  const avg = ratings[r.gameId];
  console.log(
    `${r.gameId} | ${r.reviewer || 'anonymous'} | ${r.stars}★ | team avg ${avg ? avg.average.toFixed(2) : '-'} | ${(r.comment ?? '').replace(/\s+/g, ' ').trim() || '(no comment)'}`,
  );
}
if (!args.includes('--peek')) writeFileSync(seenFile, JSON.stringify([...seen, ...fresh.map(key)], null, 2));
