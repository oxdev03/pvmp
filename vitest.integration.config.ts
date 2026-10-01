import { defineConfig } from 'vitest/config';

/** Tests against real containers. `pnpm test:integration`; CI runs them as a separate job. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One file at a time, so containers never compete for ports.
    fileParallelism: false,
  },
});
