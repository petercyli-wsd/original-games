import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Each game is lazy-loaded into its own chunk; keep the lobby chunk lean.
    chunkSizeWarningLimit: 600,
  },
});
