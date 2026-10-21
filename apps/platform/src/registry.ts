// Games are discovered from the games/ folder at build time: adding a folder
// with src/manifest.ts and src/index.ts is all it takes to appear in the lobby.
// Manifests load eagerly (they're tiny); game code is split into its own
// chunk and only fetched when someone opens the game.

import { validateManifest, type GameManifest, type GameModule, type GameStatus } from '@originals/game-sdk';

export interface GameEntry {
  manifest: GameManifest;
  load: () => Promise<GameModule>;
}

const STATUS_ORDER: Record<GameStatus, number> = { live: 0, beta: 1, prototype: 2, template: 3 };

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

const byId = new Map(games.map((g) => [g.manifest.id, g]));
export const findGame = (id: string | undefined) => (id ? byId.get(id) : undefined);
