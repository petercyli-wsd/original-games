import { defineConfig } from 'vitest/config';

// One test run across every workspace: apps, packages and games.
export default defineConfig({
  test: {
    include: ['{apps,packages,games}/*/src/**/*.test.{ts,tsx}'],
  },
});
