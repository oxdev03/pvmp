import { afterEach, describe, expect, it, vi } from 'vitest';

import { silentLog, stubFetch } from '../testing.ts';
import { jfrogAdapter, packageNameFromTarballPath } from './jfrog.ts';
import { nexusAdapter, qualifiedName } from './nexus.ts';
import type { AdapterContext } from './types.ts';
import { locateRepository } from './types.ts';
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
    expect(locateRepository(ctx({ registry }), 'jfrog', '/api/npm/')).toEqual({
      base: 'https://art.corp/artifactory',
      repo: 'npm-local',
    });
  });

  it('lets explicit baseUrl and repo settings win over the derived ones', () => {
    const located = locateRepository(
      ctx({
        registry: 'https://art.corp/artifactory/api/npm/npm-local/',
        repo: 'other',
        baseUrl: 'https://b',
      }),
      'jfrog',
      '/api/npm/',
    );
    expect(located).toEqual({ base: 'https://b', repo: 'other' });
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
    // What Nexus 3.96 returns for @corp/vsc-lint.
    [{ name: 'vsc-lint', group: 'corp' }, '@corp/vsc-lint'],
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

  const signedIn = (token: string) =>
    ctx({
      registry: 'https://nexus.corp/repository/npm-hosted/',
      http: { sourceId: 'corp', log: silentLog, token },
    });

  it('sends username:password as Basic auth, UTF-8 encoded', async () => {
    const { fetch, recorder } = stubFetch({
      'https://nexus.corp/service/rest/v1/components': { json: { items: [] } },
    });
    vi.stubGlobal('fetch', fetch);

    await nexusAdapter.listPackages(signedIn('jürgen:pa:ss'));
    expect(recorder.headers[0]?.['authorization']).toBe(
      `Basic ${Buffer.from('jürgen:pa:ss').toString('base64')}`,
    );
  });

  it('explains that the REST API rejects npm tokens', async () => {
    // Nexus 3.96 answers an npm Bearer token on the REST API with a 401.
    const { fetch } = stubFetch({
      'https://nexus.corp/service/rest/v1/components': { status: 401 },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(nexusAdapter.listPackages(signedIn('NpmToken.abc'))).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringContaining('username:password'),
    });
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
    // Unqualified: Verdaccio ignores keywords: and scope: (checked against 5 and 6).
    expect(recorder.urls[1]).toContain('/-/v1/search?text=&');
  });

  it('suggests sign-in when an anonymous listing comes back empty', async () => {
    const { fetch } = stubFetch({
      // What Verdaccio returns to an anonymous client for a private registry.
      'https://registry.corp/-/all': { json: { _updated: 99_999 } },
      'https://registry.corp/-/v1/search': { json: { objects: [] } },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(verdaccioAdapter.listPackages(ctx())).rejects.toMatchObject({ kind: 'auth' });
  });

  it('accepts an empty listing once signed in', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { _updated: 99_999 } },
      'https://registry.corp/-/v1/search': { json: { objects: [] } },
    });
    vi.stubGlobal('fetch', fetch);

    const signedIn = ctx({ http: { sourceId: 'corp', log: silentLog, token: 't' } });
    expect(await verdaccioAdapter.listPackages(signedIn)).toEqual([]);
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
