import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // All suites share one test database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
