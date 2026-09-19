import { afterEach, describe, expect, it, vi } from 'vitest';

import { silentLog, stubFetch } from '../testing.ts';
import { deriveBaseUrl, deriveRepo, jfrogAdapter, packageNameFromTarballPath } from './jfrog.ts';
import { nexusAdapter, qualifiedName } from './nexus.ts';
import type { AdapterContext } from './types.ts';
import { verdaccioAdapter } from './verdaccio.ts';

function ctx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: 'corp',
    log: silentLog,
    http: { sourceId: 'corp', log: silentLog, token: undefined },
    registry: 'https://registry.corp/',
    scope: undefined,
    repo: undefined,
    baseUrl: undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('jfrog url derivation', () => {
  it.each([
    ['/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz', '@corp/vsc-lint'],
    ['@corp/vsc-lint/-/vsc-lint-1.4.0.tgz', '@corp/vsc-lint'],
    ['/vsc-lint/-/vsc-lint-1.4.0.tgz', 'vsc-lint'],
  ])('%s -> %s', (uri, expected) => {
    expect(packageNameFromTarballPath(uri)).toBe(expected);
  });

  it('ignores a path with no /-/ segment', () => {
    expect(packageNameFromTarballPath('/random/file.tgz')).toBeUndefined();
  });

  it('derives the product base url and repo from an npm registry url', () => {
    const registry = 'https://art.corp/artifactory/api/npm/npm-local/';
    expect(deriveBaseUrl(registry)).toBe('https://art.corp/artifactory');
    expect(deriveRepo(registry)).toBe('npm-local');
  });
});

describe('jfrogAdapter', () => {
  const listing = {
    files: [
      { uri: '/', folder: true },
      { uri: '/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz', folder: false },
      { uri: '/@corp/vsc-lint/-/vsc-lint-1.3.0.tgz', folder: false },
      { uri: '/@corp/vsc-theme/-/vsc-theme-2.0.0.tgz', folder: false },
      { uri: '/@other/thing/-/thing-1.0.0.tgz', folder: false },
      { uri: '/@corp/vsc-lint/package.json', folder: false },
    ],
  };

  it('collects unique package names from the storage listing', async () => {
    const { fetch, recorder } = stubFetch({
      'https://art.corp/artifactory/api/storage/npm-local': { json: listing },
    });
    vi.stubGlobal('fetch', fetch);

    const names = await jfrogAdapter.listPackages(
      ctx({ registry: 'https://art.corp/artifactory/api/npm/npm-local/' }),
    );

    expect(names.toSorted()).toEqual(['@corp/vsc-lint', '@corp/vsc-theme', '@other/thing']);
    expect(recorder.urls[0]).toContain('api/storage/npm-local?list&deep=1');
  });

  it('honours the configured scope', async () => {
    const { fetch } = stubFetch({
      'https://art.corp/artifactory/api/storage/npm-local': { json: listing },
    });
    vi.stubGlobal('fetch', fetch);

    const names = await jfrogAdapter.listPackages(
      ctx({ registry: 'https://art.corp/artifactory/api/npm/npm-local/', scope: '@corp' }),
    );
    expect(names.toSorted()).toEqual(['@corp/vsc-lint', '@corp/vsc-theme']);
  });

  it('explains itself when the repo cannot be derived', async () => {
    vi.stubGlobal('fetch', stubFetch({}).fetch);
    await expect(jfrogAdapter.listPackages(ctx({ registry: 'https://art.corp/' }))).rejects.toThrow(
      /needs "repo"/,
    );
  });

  it('sends the bearer token', async () => {
    const { fetch, recorder } = stubFetch({
      'https://art.corp/artifactory/api/storage/npm-local': { json: listing },
    });
    vi.stubGlobal('fetch', fetch);

    await jfrogAdapter.listPackages(
      ctx({
        registry: 'https://art.corp/artifactory/api/npm/npm-local/',
        http: { sourceId: 'corp', log: silentLog, token: 'secret-token' },
      }),
    );
    expect(recorder.headers[0]?.['authorization']).toBe('Bearer secret-token');
  });

  it('reports a 401 as an auth failure', async () => {
    const { fetch } = stubFetch({
      'https://art.corp/artifactory/api/storage/npm-local': { status: 401 },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      jfrogAdapter.listPackages(
        ctx({ registry: 'https://art.corp/artifactory/api/npm/npm-local/' }),
      ),
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('nexus qualified names', () => {
  it.each([
    [{ name: 'vsc-lint', group: '@corp' }, '@corp/vsc-lint'],
    [{ name: '@corp/vsc-lint', group: '@corp' }, '@corp/vsc-lint'],
    [{ name: 'plain' }, 'plain'],
    [{ name: 'plain', group: '' }, 'plain'],
  ])('%o -> %s', (item, expected) => {
    expect(qualifiedName(item)).toBe(expected);
  });
});

describe('nexusAdapter', () => {
  it('follows the continuation cursor to the end', async () => {
    const { fetch, recorder } = stubFetch({
      'https://nexus.corp/service/rest/v1/components': (url) =>
        url.includes('continuationToken=page2')
          ? { json: { items: [{ name: 'vsc-theme', group: '@corp' }] } }
          : { json: { items: [{ name: 'vsc-lint', group: '@corp' }], continuationToken: 'page2' } },
    });
    vi.stubGlobal('fetch', fetch);

    const names = await nexusAdapter.listPackages(
      ctx({ registry: 'https://nexus.corp/repository/npm-hosted/' }),
    );

    expect(names.toSorted()).toEqual(['@corp/vsc-lint', '@corp/vsc-theme']);
    expect(recorder.urls).toHaveLength(2);
    expect(recorder.urls[1]).toContain('continuationToken=page2');
  });

  it('stops rather than looping forever on a repeating cursor', async () => {
    const { fetch, recorder } = stubFetch({
      'https://nexus.corp/service/rest/v1/components': {
        json: { items: [{ name: 'a' }], continuationToken: 'always' },
      },
    });
    vi.stubGlobal('fetch', fetch);

    await nexusAdapter.listPackages(ctx({ registry: 'https://nexus.corp/repository/npm-hosted/' }));
    expect(recorder.urls.length).toBeLessThanOrEqual(200);
  });
});

describe('verdaccioAdapter', () => {
  it('uses /-/all when available', async () => {
    const { fetch, recorder } = stubFetch({
      'https://registry.corp/-/all': {
        json: { _updated: 1, '@corp/vsc-lint': {}, '@corp/vsc-theme': {} },
      },
    });
    vi.stubGlobal('fetch', fetch);

    const names = await verdaccioAdapter.listPackages(ctx());
    expect(names.toSorted()).toEqual(['@corp/vsc-lint', '@corp/vsc-theme']);
    expect(recorder.urls).toHaveLength(1);
  });

  it('falls back to search when /-/all is unavailable', async () => {
    const { fetch, recorder } = stubFetch({
      'https://registry.corp/-/all': { status: 404 },
      'https://registry.corp/-/v1/search': {
        json: { objects: [{ package: { name: '@corp/vsc-lint' } }] },
      },
    });
    vi.stubGlobal('fetch', fetch);

    const names = await verdaccioAdapter.listPackages(ctx());
    expect(names).toEqual(['@corp/vsc-lint']);
    expect(recorder.urls[1]).toContain('/-/v1/search');
  });

  it('filters /-/all by scope and drops metadata keys', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': {
        json: { _updated: 1, '@corp/a': {}, '@other/b': {} },
      },
    });
    vi.stubGlobal('fetch', fetch);

    expect(await verdaccioAdapter.listPackages(ctx({ scope: '@corp' }))).toEqual(['@corp/a']);
  });
});
