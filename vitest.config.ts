import { defineConfig } from 'vitest/config';

// One test run across every workspace (apps, packages, games) and the scripts.
export default defineConfig({
  test: {
    include: ['{apps,packages,games}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
