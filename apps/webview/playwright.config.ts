import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // One set of goldens for every platform, generated in the Playwright
  // container by scripts/update-visual-goldens.sh. Outside the container the
  // visual suite reports diffs.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Absorbs sub-pixel antialiasing; layout drift still fails (SPEC.md §7.3).
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 420, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: PORT,
    reuseExistingServer: !process.env['CI'],
    stdout: 'ignore',
  },
});
