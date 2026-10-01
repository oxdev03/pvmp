#!/usr/bin/env node
/**
 * README screenshots of the real extension in real VS Code.
 *
 * Runs code-server in Docker with the packaged pvmp.vsix and the samples as a
 * local source, then drives the workbench with Playwright. Unlike the dev
 * harness, this exercises the real extension host, IPC, CSP and theme.
 *
 * Prerequisites (the root `pnpm screenshots` script runs both):
 *   pnpm samples && pnpm package
 */
/* oxlint-disable no-await-in-loop -- retry and polling loops wait on purpose */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, 'docs/images');
const IMAGE = 'codercom/code-server:4.139.1';
const SETTINGS = '/home/coder/.local/share/code-server/User/settings.json';

const sh = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...options });

for (const required of ['pvmp.vsix', '.samples']) {
  if (!existsSync(join(ROOT, required))) {
    throw new Error(`${required} is missing; run \`pnpm samples && pnpm package\` first`);
  }
}

/**
 * The samples' vsix files cannot be installed. These two can, so the sidebar
 * shows an installed extension and an available update.
 */
function realVsix(dir, publisher, name, version) {
  const stage = mkdtempSync(join(tmpdir(), 'vsix-'));
  mkdirSync(join(stage, 'extension'));
  writeFileSync(
    join(stage, 'extension/package.json'),
    JSON.stringify({ name, publisher, version, engines: { vscode: '^1.96.0' } }),
  );
  writeFileSync(
    join(stage, 'extension.vsixmanifest'),
    `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${name}" Version="${version}" Publisher="${publisher}" />
    <DisplayName>${name}</DisplayName>
    <Description xml:space="preserve"></Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.96.0" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>`,
  );
  writeFileSync(
    join(stage, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>`,
  );
  const file = join(dir, `${publisher}.${name}-${version}.vsix`);
  sh('zip', ['-qr', file, '.'], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
  return file;
}

function settings(extra) {
  return JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'workbench.colorTheme': 'Default Dark Modern',
    'window.commandCenter': false,
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
    // VS Code's chat panel would take a third of the frame.
    'chat.disableAIFeatures': true,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    // The status bar shows this machine's keyboard layout.
    'workbench.statusBar.visible': false,
    'pvmp.checkInterval': 0,
    'pvmp.sources': [{ type: 'local', id: 'samples', path: '/samples' }],
    ...extra,
  });
}

const fixture = mkdtempSync(join(tmpdir(), 'pvmp-shots-'));
realVsix(fixture, 'acme', 'lint', '1.9.0'); // 1.10.0 is in the samples: an update
realVsix(fixture, 'acme', 'theme', '2.1.0'); // the latest: plain "installed"
writeFileSync(join(fixture, 'settings.json'), settings({}));

const container = sh('docker', [
  'run',
  '-d',
  '--rm',
  '-p',
  '127.0.0.1::8080',
  '-v',
  `${join(ROOT, '.samples')}:/samples:ro`,
  '-v',
  `${join(ROOT, 'pvmp.vsix')}:/fixture/pvmp.vsix:ro`,
  '-v',
  `${fixture}:/fixture/extra:ro`,
  '--entrypoint',
  'sh',
  IMAGE,
  '-c',
  [
    `mkdir -p $(dirname ${SETTINGS}) /home/coder/project`,
    `cp /fixture/extra/settings.json ${SETTINGS}`,
    'for v in /fixture/pvmp.vsix /fixture/extra/*.vsix; do code-server --install-extension "$v"; done',
    'exec code-server --auth none --bind-addr 0.0.0.0:8080 /home/coder/project',
  ].join(' && '),
]).trim();

const writeSettings = (extra) =>
  sh('docker', ['exec', '-i', container, 'sh', '-c', `cat > ${SETTINGS}`], {
    input: settings(extra),
  });

/** Webviews are two iframes deep; find the one that renders `selector`. */
async function webviewFrame(page, selector) {
  for (let attempt = 0; attempt < 120; attempt++) {
    for (const frame of page.frames()) {
      if (
        await frame
          .locator(selector)
          .count()
          .catch(() => 0)
      )
        return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no webview rendered ${selector}`);
}

/** Waits until every <img> in the frame has decoded. */
async function iconsLoaded(frame) {
  await frame.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
}

/** Reloads the workbench, which picks up the settings just written. */
async function openMarketplace(page, url) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url);
      break;
    } catch (error) {
      if (attempt > 60) throw error;
      await page.waitForTimeout(1000);
    }
  }
  await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Private Marketplace/ }).click();
}

async function openDetails(page) {
  const sidebar = await webviewFrame(page, '[data-testid="row-acme.lint"]');
  await iconsLoaded(sidebar);
  await sidebar.locator('[data-testid="row-acme.lint"]').click();
  const details = await webviewFrame(page, '[data-testid="version-select"]');
  await iconsLoaded(details);
  // The badge lands once the host's first refresh finishes.
  await page.locator('.activitybar .badge-content', { hasText: '1' }).waitFor();
  await page.mouse.move(0, 0); // no hover highlight left on the row
}

const browser = await chromium.launch();
try {
  const port = sh('docker', ['port', container, '8080']).trim().split(':').pop();
  const url = `http://127.0.0.1:${port}/?folder=/home/coder/project`;
  const page = await browser.newPage({
    viewport: { width: 1360, height: 760 },
    deviceScaleFactor: 2,
    locale: 'en-US',
  });
  mkdirSync(OUT, { recursive: true });

  await openMarketplace(page, url);
  await openDetails(page);
  await page.screenshot({ path: join(OUT, 'overview-dark.png') });

  writeSettings({ 'workbench.colorTheme': 'Default Light Modern' });
  await openMarketplace(page, url);
  await openDetails(page);
  await page.screenshot({ path: join(OUT, 'overview-light.png') });

  // Add an unreachable second source to show its error banner.
  writeSettings({
    'pvmp.sources': [
      { type: 'local', id: 'samples', path: '/samples' },
      {
        type: 'npm',
        id: 'corp-verdaccio',
        registry: 'http://registry.corp.invalid/',
        adapter: 'verdaccio',
      },
    ],
  });
  await openMarketplace(page, url);
  const withError = await webviewFrame(page, '[data-testid="source-error-corp-verdaccio"]');
  await iconsLoaded(withError);
  await page.locator('[id="workbench.parts.sidebar"]').screenshot({
    path: join(OUT, 'source-error.png'),
  });

  console.log(`wrote ${OUT}/{overview-dark,overview-light,source-error}.png`);
} finally {
  await browser.close();
  sh('docker', ['rm', '-f', container]);
  rmSync(fixture, { recursive: true, force: true });
}
