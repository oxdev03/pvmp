import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
