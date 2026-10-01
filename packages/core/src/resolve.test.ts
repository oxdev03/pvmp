import type { ExtensionVersion } from '@pvmp/contract';
import { describe, expect, it } from 'vitest';

import { buildCatalog, resolveVersions, satisfiesEngine } from './resolve.ts';
import type { ResolveContext } from './resolve.ts';

function version(overrides: Partial<ExtensionVersion> & { version: string }): ExtensionVersion {
  return {
    extensionId: 'acme.lint',
    packageName: '@corp/vsc-lint',
    targetPlatform: 'universal',
    preRelease: false,
    engine: '*',
    displayName: 'Corp Lint',
    publisher: 'acme',
    publisherDisplayName: 'Acme',
    description: 'Lints things',
    categories: ['Linters'],
    sourceId: 'artifactory',
    locator: `@corp/vsc-lint@${overrides.version}`,
    ...overrides,
  };
}

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    vscodeVersion: '1.98.0',
    targetPlatform: 'darwin-arm64',
    preReleaseOptIn: new Set<string>(),
    ...overrides,
  };
}

const versions = (list: ExtensionVersion[]) => list.map((v) => v.version);

describe('satisfiesEngine', () => {
  it.each([
    ['1.98.0', '^1.96.0', true],
    ['1.95.0', '^1.96.0', false],
    ['1.98.0', '*', true],
    ['1.98.0', '', true],
    // Insiders builds carry a prerelease suffix and must still match.
    ['1.99.0-insider', '^1.96.0', true],
    ['1.98.0', '>=1.90.0 <2.0.0', true],
    ['2.0.0', '^1.96.0', false],
  ])('%s vs %s -> %s', (vscodeVersion, range, expected) => {
    expect(satisfiesEngine(vscodeVersion, range)).toBe(expected);
  });

  it('rejects an unparseable VS Code version', () => {
    expect(satisfiesEngine('not-a-version', '^1.96.0')).toBe(false);
  });
});

describe('resolveVersions ordering', () => {
  it('sorts by semver, not lexically', () => {
    // String comparison would put 1.9.0 above 1.10.0, as 1.x did.
    const resolved = resolveVersions(
      [
        version({ version: '1.9.0' }),
        version({ version: '1.10.0' }),
        version({ version: '1.2.0' }),
      ],
      ctx(),
    );
    expect(versions(resolved)).toEqual(['1.10.0', '1.9.0', '1.2.0']);
  });

  it('orders prerelease below its release', () => {
    const resolved = resolveVersions(
      [version({ version: '2.0.0' }), version({ version: '2.0.0-rc.1', preRelease: true })],
      ctx({ preReleaseOptIn: new Set(['acme.lint']) }),
    );
    expect(versions(resolved)).toEqual(['2.0.0', '2.0.0-rc.1']);
  });

  it('drops versions that are not valid semver', () => {
    const resolved = resolveVersions(
      [version({ version: '1.0.0' }), version({ version: 'latest' })],
      ctx(),
    );
    expect(versions(resolved)).toEqual(['1.0.0']);
  });
});

describe('resolveVersions filtering', () => {
  it('drops versions the running VS Code is too old for', () => {
    const resolved = resolveVersions(
      [
        version({ version: '2.0.0', engine: '^1.99.0' }),
        version({ version: '1.0.0', engine: '^1.90.0' }),
      ],
      ctx({ vscodeVersion: '1.98.0' }),
    );
    expect(versions(resolved)).toEqual(['1.0.0']);
  });

  it('keeps universal and matching-platform builds, drops the rest', () => {
    const resolved = resolveVersions(
      [
        version({ version: '3.0.0', targetPlatform: 'win32-x64' }),
        version({ version: '2.0.0', targetPlatform: 'darwin-arm64' }),
        version({ version: '1.0.0', targetPlatform: 'universal' }),
      ],
      ctx({ targetPlatform: 'darwin-arm64' }),
    );
    expect(versions(resolved)).toEqual(['2.0.0', '1.0.0']);
  });

  it('hides prereleases unless the extension is opted in', () => {
    const list = [
      version({ version: '2.0.0-beta.1', preRelease: true }),
      version({ version: '1.0.0' }),
    ];
    expect(versions(resolveVersions(list, ctx()))).toEqual(['1.0.0']);
    expect(
      versions(resolveVersions(list, ctx({ preReleaseOptIn: new Set(['acme.lint']) }))),
    ).toEqual(['2.0.0-beta.1', '1.0.0']);
  });
});

describe('resolveVersions source precedence', () => {
  it('gives the same version to the earlier-configured source and shadows the other', () => {
    const resolved = resolveVersions(
      [
        version({ version: '1.0.0', sourceId: 'local' }),
        version({ version: '1.0.0', sourceId: 'artifactory' }),
      ],
      ctx(),
      ['artifactory', 'local'],
    );
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({ sourceId: 'artifactory' });
    expect(resolved[0]?.shadowed).toBeUndefined();
    expect(resolved[1]).toMatchObject({ sourceId: 'local', shadowed: true });
  });

  it('prefers an exact platform build over a universal one regardless of priority', () => {
    const resolved = resolveVersions(
      [
        version({ version: '1.0.0', sourceId: 'first', targetPlatform: 'universal' }),
        version({ version: '1.0.0', sourceId: 'second', targetPlatform: 'darwin-arm64' }),
      ],
      ctx({ targetPlatform: 'darwin-arm64' }),
      ['first', 'second'],
    );
    expect(resolved[0]).toMatchObject({ sourceId: 'second', targetPlatform: 'darwin-arm64' });
    expect(resolved[1]).toMatchObject({ sourceId: 'first', shadowed: true });
  });
});

describe('buildCatalog', () => {
  const other = (v: string, overrides: Partial<ExtensionVersion> = {}) =>
    version({
      version: v,
      extensionId: 'acme.theme',
      packageName: '@corp/vsc-theme',
      displayName: 'Corp Theme',
      ...overrides,
    });

  it('produces one entry per extension id, sorted by display name', () => {
    const entries = buildCatalog([version({ version: '1.0.0' }), other('1.0.0')], [], ctx());
    expect(entries.map((e) => e.extensionId)).toEqual(['acme.lint', 'acme.theme']);
  });

  it('marks an entry available when nothing is installed', () => {
    const [entry] = buildCatalog([version({ version: '1.0.0' })], [], ctx());
    expect(entry).toMatchObject({ status: 'available' });
    expect(entry?.installed).toBeUndefined();
  });

  it('marks an entry installed when the newest version is already in place', () => {
    const [entry] = buildCatalog(
      [version({ version: '1.0.0' })],
      [{ extensionId: 'acme.lint', version: '1.0.0' }],
      ctx(),
    );
    expect(entry).toMatchObject({
      status: 'installed',
      installed: { version: '1.0.0', external: false },
    });
  });

  it('marks an update available using semver, not string order', () => {
    const [entry] = buildCatalog(
      [version({ version: '1.10.0' }), version({ version: '1.9.0' })],
      [{ extensionId: 'acme.lint', version: '1.9.0' }],
      ctx(),
    );
    expect(entry).toMatchObject({ status: 'update-available' });
    expect(entry?.latest?.version).toBe('1.10.0');
  });

  it('flags an installed version no source offers as external', () => {
    const [entry] = buildCatalog(
      [version({ version: '2.0.0' })],
      [{ extensionId: 'acme.lint', version: '1.5.0' }],
      ctx(),
    );
    expect(entry?.installed).toEqual({ version: '1.5.0', external: true });
  });

  it('does not flag as external a version filtered out only by compatibility', () => {
    // Offered by a source, but hidden here because this host cannot run it.
    const [entry] = buildCatalog(
      [version({ version: '2.0.0' }), version({ version: '1.5.0', targetPlatform: 'win32-x64' })],
      [{ extensionId: 'acme.lint', version: '1.5.0' }],
      ctx({ targetPlatform: 'darwin-arm64' }),
    );
    expect(entry?.installed).toEqual({ version: '1.5.0', external: false });
  });

  it('still lists an installed extension with no compatible version', () => {
    const entries = buildCatalog(
      [version({ version: '1.0.0', targetPlatform: 'win32-x64' })],
      [{ extensionId: 'acme.lint', version: '1.0.0' }],
      ctx({ targetPlatform: 'darwin-arm64' }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 'installed', versions: [] });
    expect(entries[0]?.latest).toBeUndefined();
  });

  it('omits an extension with no compatible version that is not installed', () => {
    const entries = buildCatalog(
      [version({ version: '1.0.0', engine: '^2.0.0' })],
      [],
      ctx({ vscodeVersion: '1.98.0' }),
    );
    expect(entries).toEqual([]);
  });
});
