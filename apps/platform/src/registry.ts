// Games are discovered from the games/ folder at build time: adding a folder
// with src/manifest.ts and src/index.ts is all it takes to appear in the lobby.
//
// Slot games (manifest `collection: 'slots'`) may also ship two optional JSON
// files next to their manifest. Both are picked up by import.meta.glob (eager,
// they are small) and read tolerantly by lib/slotInfo.ts:
//   games/<id>/src/slot-facts.json   RTP tier, hit rate, volatility, max win,
//                                    feature frequency and share (tile + "Slot facts" panel)
//   games/<id>/src/slot-review.json  slot AI review: overall, scores, verdict, gate
// Without them the tile and panel fall back to the manifest's rtp, volatility
// and maxMultiplier. Nothing is needed in index.ts.
//
// Manifests load eagerly (they're tiny); game code is split into its own
// chunk and only fetched when someone opens the game.

import { readSlotFacts, readSlotReview, type SlotFacts, type SlotReview } from './lib/slotInfo';
import { validateManifest, type GameManifest, type GameModule, type GameStatus } from '@originals/game-sdk';

export interface GameEntry {
  manifest: GameManifest;
  load: () => Promise<GameModule>;
}

const STATUS_ORDER: Record<GameStatus, number> = { live: 0, beta: 1, prototype: 2, retired: 3, template: 4 };

const folderOf = (path: string) => path.match(/games\/([^/]+)\/src\//)?.[1];

export function buildRegistry(
  manifests: Record<string, GameManifest>,
  loaders: Record<string, () => Promise<GameModule>>,
  { includeTemplates = false } = {},
): GameEntry[] {
  const loaderByFolder = new Map(Object.entries(loaders).map(([path, load]) => [folderOf(path), load]));
  const entries: GameEntry[] = [];

  for (const [path, manifest] of Object.entries(manifests)) {
    const folder = folderOf(path);
    const errors = validateManifest(manifest);
    if (folder !== manifest.id) errors.push(`id "${manifest.id}" must match its folder "games/${folder}"`);
    const load = loaderByFolder.get(folder);
    if (!load) errors.push(`games/${folder}/src/index.ts is missing`);
    if (errors.length) {
      console.error(`Skipping game in games/${folder}:\n  ${errors.join('\n  ')}`);
      continue;
    }
    if (manifest.status === 'template' && !includeTemplates) continue;
    entries.push({ manifest, load: load! });
  }

  return entries.sort(
    (a, b) =>
      STATUS_ORDER[a.manifest.status] - STATUS_ORDER[b.manifest.status] ||
      a.manifest.name.localeCompare(b.manifest.name),
  );
}

export const games = buildRegistry(
  import.meta.glob<GameManifest>('../../../games/*/src/manifest.ts', { eager: true, import: 'default' }),
  import.meta.glob<GameModule>('../../../games/*/src/index.ts', { import: 'default' }),
  { includeTemplates: import.meta.env.DEV || import.meta.env.VITE_SHOW_TEMPLATES === 'true' },
);

const folderJson = (files: Record<string, unknown>) => new Map(Object.entries(files).map(([path, v]) => [folderOf(path), v]));
const factsFiles = folderJson(import.meta.glob('../../../games/*/src/slot-facts.json', { eager: true, import: 'default' }));
const reviewFiles = folderJson(import.meta.glob('../../../games/*/src/slot-review.json', { eager: true, import: 'default' }));

export const isSlot = (manifest: GameManifest) => manifest.collection === 'slots';
export const slotFacts = (manifest: GameManifest): SlotFacts => readSlotFacts(manifest, factsFiles.get(manifest.id));
export const slotReview = (id: string): SlotReview | null => readSlotReview(reviewFiles.get(id));

const byId = new Map(games.map((g) => [g.manifest.id, g]));
export const findGame = (id: string | undefined) => (id ? byId.get(id) : undefined);

/** Which lobby section a game sits in: core Originals, classics, slots, experimental, retired, then templates. */
export function lobbySection(manifest: GameManifest): number {
  if (manifest.status === 'template') return 5;
  if (manifest.status === 'retired') return 4;
  if (manifest.collection === 'classics') return 1;
  if (manifest.collection === 'slots') return 2;
  return manifest.status === 'prototype' ? 3 : 0;
}

/** Games in lobby order (section, then registry order), for stepping from one game to the next. */
export const inLobbyOrder = (entries: GameEntry[]) => [...entries].sort((a, b) => lobbySection(a.manifest) - lobbySection(b.manifest));

const playOrder = inLobbyOrder(games);

/** The games either side of `id` in lobby order, wrapping at the ends. */
export function adjacentGames(id: string): { prev: GameEntry; next: GameEntry } | null {
  const i = playOrder.findIndex((g) => g.manifest.id === id);
  if (i < 0 || playOrder.length < 2) return null;
  const n = playOrder.length;
  return { prev: playOrder[(i - 1 + n) % n], next: playOrder[(i + 1) % n] };
}

/** The first game after `id` in lobby order (wrapping) that passes `test`, or null. */
export function nextGameWhere(id: string, test: (entry: GameEntry) => boolean): GameEntry | null {
  const i = playOrder.findIndex((g) => g.manifest.id === id);
  for (let step = 1; step < playOrder.length; step++) {
    const entry = playOrder[(i + step) % playOrder.length];
    if (test(entry)) return entry;
  }
  return null;
}
