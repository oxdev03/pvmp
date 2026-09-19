import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real containers, minutes not milliseconds.
 * Run with `pnpm test:integration`; CI runs them on their own job.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Containers bind ports; running suites in parallel invites collisions.
    fileParallelism: false,
  },
});
