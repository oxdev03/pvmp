import { createHash } from 'node:crypto';

import { buildPvmpTarball, packageJsonFixture, PNG_MAGIC } from '@pvmp/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verdaccioAdapter } from './adapters/index.ts';
import { npmSourceFactory, NpmSource } from './source.ts';
import { makeDeps, silentLog, stubFetch } from './testing.ts';

const REGISTRY = 'https://registry.corp/';
const TARBALL = 'https://registry.corp/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz';

function manifest(version: string, overrides: Record<string, unknown> = {}) {
  return {
    ...packageJsonFixture({ version }),
    dist: { tarball: TARBALL.replace('1.4.0', version) },
    ...overrides,
  };
}

function packument(versions: Record<string, unknown>, time: Record<string, string> = {}) {
  return { name: '@corp/vsc-lint', versions, time };
}

const tarball = buildPvmpTarball({
  packageJson: packageJsonFixture(),
  readme: '# Corp Lint',
  changelog: '## 1.4.0',
  icon: PNG_MAGIC,
  vsix: new Uint8Array([9, 9, 9]),
});

const sri = (bytes: Uint8Array) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

function source(deps = makeDeps()) {
  return new NpmSource(
    {
      id: 'corp',
      registry: REGISTRY,
      adapter: verdaccioAdapter,
      scope: undefined,
      repo: undefined,
      baseUrl: undefined,
    },
    deps,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NpmSource.list', () => {
  it('maps every packument version to an ExtensionVersion', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument(
          { '1.4.0': manifest('1.4.0'), '1.3.0': manifest('1.3.0') },
          { '1.4.0': '2026-09-01T00:00:00.000Z' },
        ),
      },
    });
    vi.stubGlobal('fetch', fetch);

    const versions = await source().list();

    expect(versions.map((v) => v.version).toSorted()).toEqual(['1.3.0', '1.4.0']);
    expect(versions[0]).toMatchObject({
      extensionId: 'acme.lint',
      packageName: '@corp/vsc-lint',
      sourceId: 'corp',
      engine: '^1.96.0',
    });
    expect(versions.find((v) => v.version === '1.4.0')?.publishedAt).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(versions[0]?.locator).toContain('.tgz');
  });

  it('ignores packages that carry no pvmp block', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { lodash: {} } },
      'https://registry.corp/lodash': {
        json: packument({
          '4.17.21': { name: 'lodash', version: '4.17.21', dist: { tarball: 'https://x/l.tgz' } },
        }),
      },
    });
    vi.stubGlobal('fetch', fetch);

    expect(await source().list()).toEqual([]);
  });

  it('skips a malformed version but keeps its siblings', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument({
          '1.4.0': manifest('1.4.0'),
          // pvmp block present but extensionId is not publisher.name
          '1.5.0': { ...manifest('1.5.0'), pvmp: { extensionId: 'nope', displayName: 'x' } },
        }),
      },
    });
    vi.stubGlobal('fetch', fetch);

    const versions = await source().list();
    expect(versions.map((v) => v.version)).toEqual(['1.4.0']);
  });

  it('skips a package whose packument fails without sinking the catalog', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {}, '@corp/broken': {} } },
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument({ '1.4.0': manifest('1.4.0') }),
      },
      'https://registry.corp/@corp%2fbroken': { status: 500 },
    });
    vi.stubGlobal('fetch', fetch);

    const versions = await source().list();
    expect(versions.map((v) => v.extensionId)).toEqual(['acme.lint']);
  });

  it('fails the source when packuments need a sign-in the listing did not', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
      'https://registry.corp/@corp%2fvsc-lint': { status: 401 },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(source().list()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('surfaces a 401 from the catalog listing as an auth failure', async () => {
    const { fetch } = stubFetch({
      'https://registry.corp/-/all': { status: 401 },
      'https://registry.corp/-/v1/search': { status: 401 },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(source().list()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('NpmSource packument caching', () => {
  it('revalidates with If-None-Match and reuses the cached body on 304', async () => {
    const deps = makeDeps();
    const { fetch, recorder } = stubFetch({
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument({ '1.4.0': manifest('1.4.0') }),
        etag: 'W/"abc"',
      },
    });
    vi.stubGlobal('fetch', fetch);

    const first = await source(deps).list();
    const second = await source(deps).list();

    expect(second).toEqual(first);
    const revalidation = recorder.headers.at(-1);
    expect(revalidation?.['if-none-match']).toBe('W/"abc"');
  });
});

describe('NpmSource fetching', () => {
  const routes = {
    'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
    'https://registry.corp/@corp%2fvsc-lint': {
      json: packument({ '1.4.0': manifest('1.4.0') }),
    },
    [TARBALL]: { body: tarball },
  };

  it('returns the vsix bytes', async () => {
    vi.stubGlobal('fetch', stubFetch(routes).fetch);
    const npm = source();
    const [version] = await npm.list();
    expect(await npm.fetchVsix(version!)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('returns readme, changelog and links', async () => {
    vi.stubGlobal('fetch', stubFetch(routes).fetch);
    const npm = source();
    const [version] = await npm.list();

    const content = await npm.fetchDetails(version!);
    expect(content.readme).toBe('# Corp Lint');
    expect(content.changelog).toBe('## 1.4.0');
    expect(content.links.repository).toBe('https://github.com/acme/lint');
  });

  it('caches details so a second read makes no request', async () => {
    const deps = makeDeps();
    const { fetch, recorder } = stubFetch(routes);
    vi.stubGlobal('fetch', fetch);

    const npm = source(deps);
    const [version] = await npm.list();
    await npm.fetchDetails(version!);
    const afterFirst = recorder.urls.length;
    await npm.fetchDetails(version!);

    expect(recorder.urls.length).toBe(afterFirst);
  });

  it('returns the icon and serves it from cache afterwards', async () => {
    const deps = makeDeps();
    const { fetch, recorder } = stubFetch(routes);
    vi.stubGlobal('fetch', fetch);

    const npm = source(deps);
    const [version] = await npm.list();

    expect(await npm.fetchIcon(version!)).toEqual(PNG_MAGIC);
    const afterFirst = recorder.urls.length;
    expect(await npm.fetchIcon(version!)).toEqual(PNG_MAGIC);
    expect(recorder.urls.length).toBe(afterFirst);
  });

  const withIntegrity = (integrity: string) => ({
    ...routes,
    'https://registry.corp/@corp%2fvsc-lint': {
      json: packument({
        '1.4.0': manifest('1.4.0', { dist: { tarball: TARBALL, integrity } }),
      }),
    },
  });

  it('accepts a vsix whose tarball matches the published integrity', async () => {
    vi.stubGlobal('fetch', stubFetch(withIntegrity(sri(tarball))).fetch);
    const npm = source();
    const [version] = await npm.list();
    expect(await npm.fetchVsix(version!)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it.each([
    ['sha512', sri(new Uint8Array([1]))],
    [
      'legacy sha1 shasum',
      createHash('sha1')
        .update(new Uint8Array([1]))
        .digest('hex'),
    ],
  ])('refuses to install a tarball that fails its %s integrity check', async (_, integrity) => {
    vi.stubGlobal('fetch', stubFetch(withIntegrity(integrity)).fetch);
    const npm = source();
    const [version] = await npm.list();
    await expect(npm.fetchVsix(version!)).rejects.toThrow(/does not match the integrity/);
  });

  it('sends the token to the registry but not to a tarball on another host', async () => {
    const foreign = 'https://cdn.elsewhere/vsc-lint-1.4.0.tgz';
    const { fetch, recorder } = stubFetch({
      ...routes,
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument({ '1.4.0': manifest('1.4.0', { dist: { tarball: foreign } }) }),
      },
      [foreign]: { body: tarball },
    });
    vi.stubGlobal('fetch', fetch);

    const npm = source(makeDeps('secret'));
    const [version] = await npm.list();
    await npm.fetchVsix(version!);

    const auth = recorder.urls.map((url, i) => [url, recorder.headers[i]?.['authorization']]);
    expect(auth).toContainEqual(['https://registry.corp/-/all', 'Bearer secret']);
    expect(auth).toContainEqual([foreign, undefined]);
  });

  it('reports a package with no extension.vsix clearly', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        ...routes,
        [TARBALL]: { body: buildPvmpTarball({ packageJson: packageJsonFixture() }) },
      }).fetch,
    );
    const npm = source();
    const [version] = await npm.list();
    await expect(npm.fetchVsix(version!)).rejects.toThrow(/no extension\.vsix/);
  });
});

describe('npmSourceFactory', () => {
  const deps = makeDeps();

  it('requires a registry', () => {
    expect(() => npmSourceFactory.create({ type: 'npm' }, deps)).toThrow(/requires a "registry"/);
  });

  it('rejects an unknown adapter by name', () => {
    expect(() =>
      npmSourceFactory.create({ type: 'npm', registry: REGISTRY, adapter: 'gitea' }, deps),
    ).toThrow(/unknown adapter "gitea"/);
  });

  it('infers jfrog and nexus from the registry url shape', () => {
    expect(
      npmSourceFactory.create(
        { type: 'npm', id: 'a', registry: 'https://art.corp/artifactory/api/npm/npm-local/' },
        deps,
      ).id,
    ).toBe('a');
    expect(
      npmSourceFactory.create(
        { type: 'npm', id: 'b', registry: 'https://nexus.corp/repository/npm-hosted/' },
        deps,
      ).id,
    ).toBe('b');
  });

  it('rejects credentials in the registry url without echoing them', () => {
    expect(() =>
      npmSourceFactory.create(
        { type: 'npm', registry: 'https://alice:hunter2@registry.corp/', adapter: 'verdaccio' },
        deps,
      ),
    ).toThrow(/must not contain credentials/);
    expect(() =>
      npmSourceFactory.create(
        { type: 'npm', registry: 'https://alice:hunter2@registry.corp/', adapter: 'verdaccio' },
        deps,
      ),
    ).not.toThrow(/hunter2/);
  });

  it('refuses to guess when the url shape says nothing', () => {
    expect(() =>
      npmSourceFactory.create({ type: 'npm', registry: 'https://registry.corp/' }, deps),
    ).toThrow(/could not infer a catalog adapter/);
  });

  it('accepts an explicit adapter for an unrecognised url', () => {
    const created = npmSourceFactory.create(
      { type: 'npm', id: 'v', registry: REGISTRY, adapter: 'verdaccio' },
      deps,
    );
    expect(created.id).toBe('v');
  });
});

describe('logging', () => {
  it('does not leak the token into logs', async () => {
    const messages: string[] = [];
    const deps = makeDeps('super-secret');
    deps.log = { ...silentLog, trace: (m) => messages.push(m), debug: (m) => messages.push(m) };

    vi.stubGlobal('fetch', stubFetch(routesWithAuth()).fetch);
    await source(deps).list();

    expect(messages.join('\n')).not.toContain('super-secret');
  });

  function routesWithAuth() {
    return {
      'https://registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
      'https://registry.corp/@corp%2fvsc-lint': {
        json: packument({ '1.4.0': manifest('1.4.0') }),
      },
    };
  }
});

describe('credentials never reach logs or errors', () => {
  const WITH_CREDS = 'https://alice:hunter2@registry.corp/';

  function credentialSource(deps = makeDeps()) {
    return new NpmSource(
      {
        id: 'corp',
        registry: WITH_CREDS,
        adapter: verdaccioAdapter,
        scope: undefined,
        repo: undefined,
        baseUrl: undefined,
      },
      deps,
    );
  }

  it('strips userinfo from trace logging', async () => {
    const messages: string[] = [];
    const deps = makeDeps();
    deps.log = { ...silentLog, trace: (m) => messages.push(m), debug: (m) => messages.push(m) };

    vi.stubGlobal(
      'fetch',
      stubFetch({
        'https://alice:hunter2@registry.corp/-/all': { json: { '@corp/vsc-lint': {} } },
        'https://alice:hunter2@registry.corp/@corp%2fvsc-lint': {
          json: packument({ '1.4.0': manifest('1.4.0') }),
        },
      }).fetch,
    );
    await credentialSource(deps).list();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).not.toContain('hunter2');
    expect(messages.join('\n')).not.toContain('alice');
  });

  it('strips userinfo that fetch quotes in its own error', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.reject(
        new TypeError(
          `Request cannot be constructed from a URL that includes credentials: ${input}`,
        ),
      ),
    );

    await expect(credentialSource().list()).rejects.toSatisfy(
      (error: Error) => !error.message.includes('hunter2') && error.message.includes('credentials'),
    );
  });

  it('strips userinfo from the error the webview renders', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        'https://alice:hunter2@registry.corp/-/all': { status: 401 },
        'https://alice:hunter2@registry.corp/-/v1/search': { status: 401 },
      }).fetch,
    );

    await expect(credentialSource().list()).rejects.toSatisfy(
      (error: Error) =>
        !error.message.includes('hunter2') && error.message.includes('registry.corp'),
    );
  });
});
