import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Deep links (/play/drift, /rankings) must serve the app even when the host
 * has no SPA rewrite rule configured. After the build, copy index.html to
 * every route's own folder, and to 404.html for anything else. Asset URLs are
 * absolute, so the copies work from any depth.
 */
function routePages(): Plugin {
  let outDir = '';
  return {
    name: 'route-pages',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const gamesDir = join(__dirname, '..', '..', 'games');
      const games = readdirSync(gamesDir).filter((id) => existsSync(join(gamesDir, id, 'src', 'manifest.ts')));
      const routes = ['rankings', 'evaluator', ...games.map((id) => `play/${id}`)];
      const index = join(outDir, 'index.html');
      for (const route of routes) {
        mkdirSync(join(outDir, route), { recursive: true });
        copyFileSync(index, join(outDir, route, 'index.html'));
      }
      copyFileSync(index, join(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), routePages()],
  build: {
    // Each game is lazy-loaded into its own chunk; keep the lobby chunk lean.
    chunkSizeWarningLimit: 600,
  },
});
