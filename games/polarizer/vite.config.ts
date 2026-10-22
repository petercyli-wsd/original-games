import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standalone dev server for this game only. The platform bundles the game itself.
export default defineConfig({
  plugins: [react()],
});
