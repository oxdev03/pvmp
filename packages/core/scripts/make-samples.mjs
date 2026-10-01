#!/usr/bin/env node
/**
 * Generates sample extension packages in the pvmp format, so a local source
 * has something real to show without standing up a registry.
 *
 *   pnpm samples            -> .samples/
 *   pnpm samples ~/somewhere
 *
 * Self-contained on purpose: plain JS against fflate and nanotar, so it runs
 * with bare node and needs no TypeScript loader.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { gzipSync } from 'fflate';
import { createTar } from 'nanotar';

const OUT = resolve(process.argv[2] ?? '.samples');
const encoder = new TextEncoder();

/** A tiny PNG, via rsvg-convert when present, else a 1x1 placeholder. */
function icon(hue, initials) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="10" fill="hsl(${hue} 55% 45%)"/><text x="32" y="43" font-family="Helvetica,sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  try {
    const tmp = resolve(OUT, '.icon.svg');
    writeFileSync(tmp, svg);
    execFileSync('rsvg-convert', ['-w', '64', '-h', '64', tmp, '-o', resolve(OUT, '.icon.png')]);
    const bytes = readFileSync(resolve(OUT, '.icon.png'));
    rmSync(tmp, { force: true });
    rmSync(resolve(OUT, '.icon.png'), { force: true });
    return new Uint8Array(bytes);
  } catch {
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
  }
}

/**
 * A stand-in .vsix. It is a real zip so it looks right to anything that
 * sniffs magic bytes, but installing it will fail — these samples exist to
 * exercise browsing, not installation.
 */
function fakeVsix(id, version) {
  const name = 'extension/package.json';
  const body = encoder.encode(JSON.stringify({ name: id, version }));
  // Minimal stored (uncompressed) zip.
  const nameBytes = encoder.encode(name);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;

  const local = new Uint8Array(30 + nameBytes.length + body.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 0, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, body.length, true);
  lv.setUint32(22, body.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(body, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, body.length, true);
  cv.setUint32(24, body.length, true);
  cv.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

function build({
  pkg,
  id,
  display,
  publisher,
  version,
  description,
  categories,
  readme,
  changelog,
  hue,
  preRelease = false,
  targetPlatform = 'universal',
  engine = '^1.96.0',
}) {
  const packageJson = {
    name: pkg,
    version,
    description,
    categories,
    keywords: ['vscode-extension', 'pvmp'],
    engines: { vscode: engine },
    license: 'MIT',
    repository: { url: `https://github.com/acme/${id.split('.')[1]}` },
    homepage: `https://acme.example/${id.split('.')[1]}`,
    bugs: { url: `https://github.com/acme/${id.split('.')[1]}/issues` },
    pvmp: {
      extensionId: id,
      displayName: display,
      publisherDisplayName: publisher,
      targetPlatform,
      preRelease,
    },
  };

  // Metadata first, extension.vsix last — SPEC.md §2.1.
  const files = [
    { name: 'package/package.json', data: encoder.encode(JSON.stringify(packageJson, null, 2)) },
    { name: 'package/icon.png', data: icon(hue, display.slice(0, 2).toUpperCase()) },
    { name: 'package/README.md', data: encoder.encode(readme) },
    { name: 'package/CHANGELOG.md', data: encoder.encode(changelog) },
    { name: 'package/extension.vsix', data: fakeVsix(id, version) },
  ];

  const filename = `${pkg.replace('@', '').replace('/', '-')}-${version}.tgz`;
  writeFileSync(resolve(OUT, filename), gzipSync(createTar(files)));
  return filename;
}

const README = (name, extra = '') => `# ${name}

${extra || `Sample package generated by \`pnpm samples\`. It exists so the local source has something realistic to render.`}

## Features

- Renders a README through the sanitizing markdown pipeline
- Exercises GFM tables and fenced code

| Setting | Default | Description |
| --- | --- | --- |
| \`${name.toLowerCase().replace(/\s+/g, '')}.enabled\` | \`true\` | Turns it on |
| \`${name.toLowerCase().replace(/\s+/g, '')}.strict\` | \`false\` | Warnings become errors |

\`\`\`jsonc
{
  "${name.toLowerCase().replace(/\s+/g, '')}.enabled": true
}
\`\`\`
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const written = [];

for (const version of ['1.10.0', '1.9.0', '1.2.0']) {
  written.push(
    build({
      pkg: '@corp/vsc-lint',
      id: 'acme.lint',
      display: 'Corp Lint',
      publisher: 'Acme Corp',
      version,
      description: 'Company lint rules with autofix for internal style conventions.',
      categories: ['Linters', 'Formatters'],
      readme: README('Corp Lint'),
      changelog: `## 1.10.0\n\n- Autofix for the naming rule\n\n## 1.9.0\n\n- First release\n`,
      hue: 350,
    }),
  );
}

for (const version of ['2.1.0', '2.0.0']) {
  written.push(
    build({
      pkg: '@corp/vsc-theme',
      id: 'acme.theme',
      display: 'Corp Theme',
      publisher: 'Acme Corp',
      version,
      description: 'The official dark and light themes.',
      categories: ['Themes'],
      readme: README('Corp Theme'),
      changelog: `## ${version}\n\n- Contrast fixes\n`,
      hue: 280,
    }),
  );
}

written.push(
  build({
    pkg: '@corp/vsc-snippets',
    id: 'acme.snippets',
    display: 'Corp Snippets',
    publisher: 'Acme Corp',
    version: '1.0.0',
    description: 'Shared snippets for internal frameworks.',
    categories: ['Snippets'],
    readme: README('Corp Snippets'),
    changelog: '## 1.0.0\n\n- Initial\n',
    hue: 150,
  }),
);

// A pre-release: hidden until you tick "Include pre-releases" on its page.
written.push(
  build({
    pkg: '@platform/tooling',
    id: 'platform.tooling',
    display: 'Platform Tooling',
    publisher: 'Platform Team',
    version: '3.0.0-rc.2',
    description: 'CLI integration for the platform team toolchain.',
    categories: ['Other'],
    readme: README('Platform Tooling'),
    changelog: '## 3.0.0-rc.2\n\n- Release candidate\n',
    hue: 220,
    preRelease: true,
  }),
);
written.push(
  build({
    pkg: '@platform/tooling',
    id: 'platform.tooling',
    display: 'Platform Tooling',
    publisher: 'Platform Team',
    version: '2.8.0',
    description: 'CLI integration for the platform team toolchain.',
    categories: ['Other'],
    readme: README('Platform Tooling'),
    changelog: '## 2.8.0\n\n- Stable\n',
    hue: 220,
  }),
);

// Requires a newer VS Code than exists, so it must be filtered out entirely.
written.push(
  build({
    pkg: '@corp/vsc-future',
    id: 'acme.future',
    display: 'Future Only',
    publisher: 'Acme Corp',
    version: '1.0.0',
    description: 'Should never appear: requires VS Code ^99.0.0.',
    categories: ['Other'],
    readme: README('Future Only'),
    changelog: '## 1.0.0\n',
    hue: 20,
    engine: '^99.0.0',
  }),
);

// Wrong platform, so it must also be filtered out.
written.push(
  build({
    pkg: '@corp/vsc-wrongarch',
    id: 'acme.wrongarch',
    display: 'Wrong Arch',
    publisher: 'Acme Corp',
    version: '1.0.0',
    description: 'Should never appear: built for win32-x64.',
    categories: ['Other'],
    readme: README('Wrong Arch'),
    changelog: '## 1.0.0\n',
    hue: 40,
    targetPlatform: 'win32-x64',
  }),
);

// A throwaway workspace the F5 launch config opens, pre-pointed at the
// samples, so trying the extension needs no manual settings.
const devWorkspace = resolve(process.cwd(), 'dev-workspace');
mkdirSync(resolve(devWorkspace, '.vscode'), { recursive: true });
writeFileSync(
  resolve(devWorkspace, '.vscode', 'settings.json'),
  `${JSON.stringify(
    {
      'pvmp.sources': [{ type: 'local', path: OUT, depth: 2 }],
      'pvmp.checkInterval': 0,
      'pvmp.autoUpdate': false,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  resolve(devWorkspace, 'README.md'),
  '# pvmp dev workspace\n\nGenerated by `pnpm samples`. Opened by the F5 launch config,\nwith `pvmp.sources` already pointed at ../.samples.\n',
);

console.log(`wrote ${written.length} package(s) to ${OUT}`);
for (const name of written.toSorted()) console.log(`  ${name}`);
console.log(`
Two of these are filtered out by design (acme.future needs VS Code ^99,
acme.wrongarch is win32-x64), so the list should show 4 extensions.`);
