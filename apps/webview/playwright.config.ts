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
  // Goldens are keyed by name only, not by platform: they are generated in the
  // Playwright container by scripts/update-visual-goldens.sh, so there is one
  // canonical set and a developer machine compares against the same images CI
  // does. Running the visual suite outside the container will report diffs.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Font rasterisation differs across platforms; goldens are generated in
      // the same container CI runs (SPEC.md §7.3). A small threshold absorbs
      // sub-pixel antialiasing without hiding real layout drift.
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
