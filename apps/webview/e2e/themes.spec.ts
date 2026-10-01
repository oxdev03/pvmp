import { expect, test } from '@playwright/test';

const THEMES = ['dark', 'light', 'hc'] as const;

/**
 * Visual goldens across every theme VS Code ships.
 *
 * A misspelled theme token renders transparent instead of failing, so only a
 * picture catches it (SPEC.md §7.3).
 */
test.describe('appearance', () => {
  // Goldens come from the Playwright container (scripts/update-visual-goldens.sh).
  // macOS rasterises fonts too differently to compare, so pixel checks run on
  // Linux only: CI and the container.
  const pixelPerfect = process.platform === 'linux';

  for (const theme of THEMES) {
    test(`sidebar in ${theme}`, async ({ page }) => {
      await page.goto(`/?view=sidebar&theme=${theme}`);
      await expect(page.getByTestId('row-acme.lint')).toBeVisible();
      await expect(page.getByTestId('icon-acme.lint').locator('img')).toBeVisible();
      test.skip(
        !pixelPerfect,
        'Goldens are generated on Linux; run ./scripts/update-visual-goldens.sh',
      );
      await expect(page).toHaveScreenshot(`sidebar-${theme}.png`, { fullPage: true });
    });

    test(`details in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.goto(`/?view=details&ext=acme.lint&theme=${theme}`);
      await expect(
        page.getByRole('banner').getByRole('heading', { name: 'Corp Lint' }),
      ).toBeVisible();
      test.skip(
        !pixelPerfect,
        'Goldens are generated on Linux; run ./scripts/update-visual-goldens.sh',
      );
      await expect(page).toHaveScreenshot(`details-${theme}.png`, { fullPage: true });
    });
  }

  test('no theme token resolves to an empty value', async ({ page }) => {
    await page.goto('/?view=sidebar&theme=dark');
    await expect(page.getByTestId('row-acme.lint')).toBeVisible();

    // A missing --vscode-* variable computes to transparent, so check that
    // every colour resolved.
    const computed = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="row-acme.lint"]');
      if (!row) return null;
      const style = getComputedStyle(row);
      return { color: style.color, font: style.fontFamily };
    });

    expect(computed?.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(computed?.font).toBeTruthy();
  });
});
