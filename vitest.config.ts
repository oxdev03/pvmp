import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    // Integration tests need Docker and take minutes: `pnpm test:integration`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
