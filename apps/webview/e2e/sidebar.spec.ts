import { expect, test } from '@playwright/test';

const sidebar = (query = '') => `/?view=sidebar${query}`;

test.describe('sidebar catalog', () => {
  test('groups extensions into updates, installed and available', async ({ page }) => {
    await page.goto(sidebar());

    await expect(page.getByRole('button', { name: /^Updates Available/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Installed/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Available/ })).toBeVisible();

    // acme.lint is installed at 1.9.0 with 1.10.0 offered.
    const updates = page.getByTestId('section-updates-available');
    await expect(updates.getByTestId('row-acme.lint')).toBeVisible();
  });

  test('a row shows name, version, description and publisher', async ({ page }) => {
    await page.goto(sidebar());
    const row = page.getByTestId('row-acme.lint');

    await expect(row).toContainText('Corp Lint');
    await expect(row).toContainText('v1.9.0');
    await expect(row).toContainText('Company lint rules');
    await expect(row).toContainText('Acme Corp');
  });

  test('rows are the height VS Code uses', async ({ page }) => {
    await page.goto(sidebar());
    const box = await page.getByTestId('row-acme.lint').boundingBox();
    // EXTENSION_LIST_ELEMENT_HEIGHT in extensionsList.ts
    expect(box?.height).toBe(72);
  });

  test('a section collapses and expands', async ({ page }) => {
    await page.goto(sidebar());
    const header = page.getByRole('button', { name: /^Installed/ });

    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('row-acme.theme')).toBeHidden();
  });

  test('flags an extension installed from outside the marketplace', async ({ page }) => {
    await page.goto(sidebar());
    await expect(page.getByTestId('row-acme.deploy')).toContainText('external');
  });

  test('shows the empty state when no source offers anything', async ({ page }) => {
    await page.goto(sidebar('&fixture=empty'));
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Folder Source' })).toBeVisible();
  });
});

test.describe('install lifecycle', () => {
  test('installs an available extension and moves it to Installed', async ({ page }) => {
    await page.goto(sidebar());
    const row = page.getByTestId('row-acme.snippets');

    await row.getByRole('button', { name: 'Install' }).click();

    await expect(
      page.getByTestId('section-installed').getByTestId('row-acme.snippets'),
    ).toBeVisible();
  });

  test('reports progress while a slow install runs', async ({ page }) => {
    await page.goto(sidebar('&fixture=slow-install'));
    await page.getByTestId('row-acme.snippets').getByRole('button', { name: 'Install' }).click();

    await expect(page.getByTestId('progress-acme.snippets')).toBeVisible();
    await expect(page.getByTestId('progress-acme.snippets')).toContainText(
      /Downloading|Extracting|Installing/,
    );
  });

  test('updates an outdated extension to the newest version', async ({ page }) => {
    await page.goto(sidebar());
    const row = page.getByTestId('row-acme.lint');
    await expect(row).toContainText('v1.9.0');

    await row.getByRole('button', { name: 'Update' }).click();

    await expect(page.getByTestId('section-installed').getByTestId('row-acme.lint')).toContainText(
      'v1.10.0',
    );
  });

  test('uninstalls an installed extension', async ({ page }) => {
    await page.goto(sidebar());
    const row = page.getByTestId('row-acme.theme');
    await row.hover();
    await row.getByRole('button', { name: 'Uninstall' }).click();

    await expect(page.getByTestId('section-available').getByTestId('row-acme.theme')).toBeVisible();
  });
});

test.describe('source failures', () => {
  test('offers sign-in for a 401 and recovers the catalog', async ({ page }) => {
    await page.goto(sidebar('&fixture=auth'));

    const banner = page.getByTestId('source-error-corp-artifactory');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('401');

    await banner.getByRole('button', { name: 'Sign in' }).click();

    await expect(banner).toBeHidden();
    await expect(page.getByTestId('row-acme.lint')).toBeVisible();
  });

  test('shows an unreachable source without hiding the rest of the catalog', async ({ page }) => {
    await page.goto(sidebar('&fixture=unreachable'));

    const banner = page.getByTestId('source-error-corp-artifactory');
    await expect(banner).toContainText('Could not reach');
    // No sign-in offered: this is not something a click fixes.
    await expect(banner.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByTestId('row-acme.lint')).toBeVisible();
  });
});

test.describe('icons', () => {
  test('loads an icon per row', async ({ page }) => {
    await page.goto(sidebar());
    await expect(page.getByTestId('icon-acme.lint').locator('img')).toBeVisible();
  });

  test('falls back to a glyph when the package ships no icon', async ({ page }) => {
    await page.goto(sidebar('&fixture=no-icons'));
    const icon = page.getByTestId('icon-acme.lint');
    await expect(icon.locator('img')).toHaveCount(0);
    await expect(icon.locator('svg')).toBeVisible();
  });

  test('does not request icons for rows that were never scrolled into view', async ({ page }) => {
    // 40 entries at 72px is far taller than the viewport, so most rows start
    // off screen. This is the assertion that lazy icon loading actually works;
    // without it every row would drag down a tarball (SPEC.md §6.3).
    await page.goto(sidebar('&fixture=many'));
    await expect(page.getByTestId('icon-acme.pkg00').locator('img')).toBeVisible();

    const iconCalls = () =>
      page.evaluate(
        () => window.__pvmpMock?.calls.filter((call) => call.method === 'getIcon').length ?? 0,
      );

    const initial = await iconCalls();
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(40);

    await page.getByTestId('row-acme.pkg39').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('icon-acme.pkg39').locator('img')).toBeVisible();
    expect(await iconCalls()).toBeGreaterThan(initial);
  });
});
