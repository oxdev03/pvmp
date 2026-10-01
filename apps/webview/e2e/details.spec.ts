import { expect, test } from '@playwright/test';

const details = (ext = 'acme.lint', query = '') => `/?view=details&ext=${ext}${query}`;

test.describe('details page targeting', () => {
  /*
   * The host passes the target as a data-* attribute on #root, and the
   * harness sets it the same way. A camelCase attribute name once left every
   * details panel empty, because the HTML parser lowercases it.
   */
  test('reads its target from the root attribute the host writes', async ({ page }) => {
    await page.goto(details());

    await expect(page.locator('#root')).toHaveAttribute('data-extension-id', 'acme.lint');
    await expect(
      page.getByRole('banner').getByRole('heading', { name: 'Corp Lint' }),
    ).toBeVisible();
  });

  test('says so plainly when opened with no target', async ({ page }) => {
    await page.goto('/?view=details&ext=');

    await expect(page.getByTestId('details-no-target')).toBeVisible();
    // Must not sit on a spinner, and must not ask the host for extension "".
    await expect(page.getByText('Loading…')).toHaveCount(0);

    const asked = await page.evaluate(
      () => window.__pvmpMock?.calls.filter((call) => call.method === 'getDetails').length ?? 0,
    );
    expect(asked).toBe(0);
  });
});

test.describe('details page', () => {
  test('renders the hero with publisher, identifier and description', async ({ page }) => {
    await page.goto(details());

    const hero = page.getByRole('banner');
    await expect(hero.getByRole('heading', { name: 'Corp Lint', level: 1 })).toBeVisible();
    await expect(hero.getByText('Acme Corp')).toBeVisible();
    // Also appears in the More Info table, so scope to the hero.
    await expect(hero.getByText('acme.lint')).toBeVisible();
  });

  test('lists every version and switches the selection', async ({ page }) => {
    await page.goto(details());
    const select = page.getByTestId('version-select');

    await expect(select.locator('option')).toHaveCount(3);
    await select.selectOption('1.2.0');
    await expect(page.getByRole('button', { name: 'Install v1.2.0' })).toBeVisible();
  });

  test('switches between the Details and Changelog tabs', async ({ page }) => {
    await page.goto(details());

    await expect(page.getByTestId('tab-details')).toContainText('Company lint rules');

    await page.getByRole('tab', { name: 'Changelog' }).click();
    await expect(page.getByTestId('tab-changelog')).toContainText('Added autofix');
  });

  test('renders README markdown, including GFM tables', async ({ page }) => {
    await page.goto(details());
    const body = page.getByTestId('tab-details');

    await expect(body.getByRole('heading', { name: 'Features' })).toBeVisible();
    await expect(body.locator('table')).toBeVisible();
    await expect(body.locator('code').first()).toBeVisible();
  });

  test('shows categories, resources and more info', async ({ page }) => {
    await page.goto(details());

    const aside = page.getByRole('complementary');
    await expect(aside.getByText('Linters')).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Repository' })).toHaveAttribute(
      'href',
      'https://github.com/acme/lint',
    );
    await expect(aside.getByText('corp-artifactory')).toBeVisible();
  });

  test('warns when the installed version came from outside the marketplace', async ({ page }) => {
    await page.goto(details('acme.deploy'));
    await expect(page.getByTestId('external-warning')).toContainText('not offered by any');
  });

  test('reports an unknown extension instead of rendering blank', async ({ page }) => {
    await page.goto(details('does.notexist'));
    await expect(page.getByTestId('details-error')).toContainText('No such extension');
  });
});

test.describe('markdown is sanitized', () => {
  test('strips scripts, event handlers and javascript: urls', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(details('acme.lint', '&fixture=unsafe-readme'));
    const body = page.getByTestId('tab-details');
    await expect(body.getByRole('heading', { name: 'Unsafe' })).toBeVisible();

    // The payload sets window.__pvmpXss if any vector survives.
    await expect(body.locator('script')).toHaveCount(0);
    await expect(body.locator('[onerror]')).toHaveCount(0);

    const link = body.getByRole('link', { name: 'click me' });
    if ((await link.count()) > 0) {
      await expect(link).not.toHaveAttribute('href', /^javascript:/);
    }

    await expect(body.getByRole('link', { name: 'normal link' })).toHaveAttribute(
      'href',
      'https://example.com',
    );

    expect(
      await page.evaluate(() => (window as { __pvmpXss?: boolean }).__pvmpXss),
    ).toBeUndefined();
    expect(errors).toEqual([]);
  });
});
