import type { FileStore, Logger, SourceDeps } from '@pvmp/core';
import { BlobCache, createMemoryFileStore } from '@pvmp/core';
import { buildPvmpTarball, packageJsonFixture, PNG_MAGIC } from '@pvmp/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localSourceFactory, LocalSource } from './index.ts';

const silentLog: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function harness() {
  const files = createMemoryFileStore();
  const cache = new BlobCache(files, 'cache');
  const deps: SourceDeps = {
    log: silentLog,
    cache,
    files,
    getToken: () => Promise.resolve(undefined),
    resolvePath: (input) => input.replace('${userHome}', '/home/dev'),
  };
  return { files, cache, deps };
}

function writeTarball(files: FileStore, path: string, name: string, version: string, extra = {}) {
  return files.write(
    path,
    buildPvmpTarball({
      packageJson: packageJsonFixture({
        name: `@corp/${name}`,
        version,
        pvmp: { extensionId: `acme.${name}`, displayName: name },
        ...extra,
      }),
      readme: `# ${name}`,
      changelog: `## ${version}`,
      icon: PNG_MAGIC,
      vsix: new Uint8Array([1, 2, 3]),
    }),
  );
}

describe('localSourceFactory', () => {
  it('rejects a config with no path', () => {
    const { deps } = harness();
    expect(() => localSourceFactory.create({ type: 'local' }, deps)).toThrow(/requires a "path"/);
  });

  it('expands variables in the configured path', async () => {
    const { files, deps } = harness();
    await writeTarball(files, '/home/dev/vsix/a.tgz', 'lint', '1.0.0');
    const source = localSourceFactory.create({ type: 'local', path: '${userHome}/vsix' }, deps);
    expect(await source.list()).toHaveLength(1);
  });

  it('falls back to a default depth for a non-integer depth', async () => {
    const { files, deps } = harness();
    await writeTarball(files, '/r/a/b/c/deep.tgz', 'lint', '1.0.0');
    const source = localSourceFactory.create({ type: 'local', path: '/r', depth: 'lots' }, deps);
    // Default depth is 3, so /r/a/b/c is out of reach.
    expect(await source.list()).toHaveLength(0);
  });
});

describe('LocalSource.list', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  const source = (depth = 3, root = '/vsix') => new LocalSource('local', root, depth, h.deps);

  it('finds every .tgz and maps it to an ExtensionVersion', async () => {
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.4.0');
    await writeTarball(h.files, '/vsix/theme.tgz', 'theme', '2.0.0');

    const versions = await source().list();
    expect(versions.map((v) => v.extensionId).toSorted()).toEqual(['acme.lint', 'acme.theme']);
    expect(versions[0]).toMatchObject({
      sourceId: 'local',
      packageName: expect.stringContaining('@corp/'),
    });
  });

  it('recurses to the configured depth and no further', async () => {
    await writeTarball(h.files, '/vsix/top.tgz', 'a', '1.0.0');
    await writeTarball(h.files, '/vsix/one/mid.tgz', 'b', '1.0.0');
    await writeTarball(h.files, '/vsix/one/two/deep.tgz', 'c', '1.0.0');

    expect(await source(1).list()).toHaveLength(1);
    expect(await source(2).list()).toHaveLength(2);
    expect(await source(3).list()).toHaveLength(3);
  });

  it('does not descend into node_modules', async () => {
    await writeTarball(h.files, '/vsix/node_modules/pkg.tgz', 'a', '1.0.0');
    expect(await source().list()).toHaveLength(0);
  });

  it('ignores files that are not .tgz', async () => {
    await h.files.write('/vsix/notes.txt', new TextEncoder().encode('hi'));
    await h.files.write('/vsix/old.vsix', new Uint8Array([1]));
    expect(await source().list()).toHaveLength(0);
  });

  it('skips an unreadable package instead of failing the whole scan, and says so', async () => {
    const warn = vi.fn<(message: string) => void>();
    h.deps.log = { ...silentLog, warn };
    await writeTarball(h.files, '/vsix/good.tgz', 'lint', '1.0.0');
    await h.files.write('/vsix/corrupt.tgz', new TextEncoder().encode('not a gzip'));

    const versions = await source().list();
    expect(versions.map((v) => v.extensionId)).toEqual(['acme.lint']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/vsix/corrupt.tgz'));
  });

  it('lowercases the extension id, which VS Code compares case-insensitively', async () => {
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0', {
      pvmp: { extensionId: 'Acme.Lint' },
    });
    const [version] = await source().list();
    expect(version).toMatchObject({ extensionId: 'acme.lint', publisher: 'Acme' });
  });

  it('skips a tarball with no pvmp block', async () => {
    await h.files.write(
      '/vsix/plain.tgz',
      buildPvmpTarball({ packageJson: { name: 'plain', version: '1.0.0' } }),
    );
    expect(await source().list()).toHaveLength(0);
  });

  it('reports a folder that does not exist as a config error', async () => {
    await expect(source(3, '/nowhere').list()).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('/nowhere'),
    });
  });
});

describe('LocalSource caching', () => {
  it('does not re-read a tarball whose mtime and size are unchanged', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const read = vi.spyOn(h.files, 'read');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const tarballReads = () => read.mock.calls.filter(([p]) => p === '/vsix/lint.tgz').length;

    await source.list();
    expect(tarballReads()).toBe(1);

    await source.list();
    expect(tarballReads()).toBe(1);
  });

  it('re-reads after the file changes', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    expect((await source.list())[0]?.version).toBe('1.0.0');

    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '2.0.0');
    expect((await source.list())[0]?.version).toBe('2.0.0');
  });
});

describe('LocalSource fetching', () => {
  it('returns readme, changelog and links', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();

    const content = await source.fetchDetails(version!);
    expect(content.readme).toBe('# lint');
    expect(content.changelog).toBe('## 1.0.0');
    expect(content.links.repository).toBe('https://github.com/acme/lint');
  });

  it('returns the icon bytes', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();
    expect(await source.fetchIcon(version!)).toEqual(PNG_MAGIC);
  });

  it('re-extracts an icon that was evicted while its meta entry survived', async () => {
    // meta and icon are separate index entries with their own LRU seq, so the
    // icon can go while #read still short-circuits on the cached meta.
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();
    expect(await source.fetchIcon(version!)).toEqual(PNG_MAGIC);

    const icons = await h.files.list('cache/icon');
    await Promise.all(icons.map((entry) => h.files.remove(`cache/icon/${entry.name}`)));

    expect(await source.fetchIcon(version!)).toEqual(PNG_MAGIC);
  });

  it('returns the vsix bytes', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();
    expect(await source.fetchVsix(version!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reports a clear failure when the file vanished before install', async () => {
    const h = harness();
    await writeTarball(h.files, '/vsix/lint.tgz', 'lint', '1.0.0');
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();

    await h.files.remove('/vsix/lint.tgz');
    await expect(source.fetchVsix(version!)).rejects.toThrow(/no longer exists/);
  });

  it('reports a clear failure when the package ships no vsix', async () => {
    const h = harness();
    await h.files.write(
      '/vsix/novsix.tgz',
      buildPvmpTarball({ packageJson: packageJsonFixture() }),
    );
    const source = new LocalSource('local', '/vsix', 3, h.deps);
    const [version] = await source.list();
    await expect(source.fetchVsix(version!)).rejects.toThrow(/no extension\.vsix/);
  });
});

describe('LocalSource.watch', () => {
  it('registers a watcher once and disposes it', () => {
    const h = harness();
    const stop = vi.fn<() => void>();
    const watch = vi.fn<(root: string, onChange: () => void) => () => void>(() => stop);
    const source = new LocalSource('local', '/vsix', 3, { ...h.deps, watch });

    source.watch(() => {});
    source.watch(() => {});
    expect(watch).toHaveBeenCalledTimes(1);

    source.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
