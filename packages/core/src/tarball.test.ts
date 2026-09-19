import { describe, expect, it } from 'vitest';

import { ManifestError } from './errors.ts';
import { normalizeEntryName } from './tar.ts';
import { readIconFromStream, readPvmpTarball } from './tarball.ts';
import {
  buildPvmpTarball,
  buildRawTar,
  incompressibleBytes,
  packageJsonFixture,
  PNG_MAGIC,
} from './testing.ts';

const encoder = new TextEncoder();

const PACKAGE_JSON = packageJsonFixture();

/** Builds a tarball in the pvmp layout: metadata first, vsix last (SPEC §2.1). */
function buildTarball(options: { vsixBytes?: number; metadataFirst?: boolean } = {}) {
  const { vsixBytes = 2048, metadataFirst = true } = options;
  return buildPvmpTarball({
    packageJson: PACKAGE_JSON,
    icon: new Uint8Array([...PNG_MAGIC, 1, 2, 3]),
    readme: '# Corp Lint\n',
    changelog: '## 1.4.0\n',
    vsix: incompressibleBytes(vsixBytes),
    vsixFirst: !metadataFirst,
  });
}

describe('normalizeEntryName', () => {
  it.each([
    ['package/package.json', 'package.json'],
    ['./package/README.md', 'readme.md'],
    ['package/extension.vsix', 'extension.vsix'],
    ['package/Icon.PNG', 'icon.png'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEntryName(input)).toBe(expected);
  });
});

describe('readPvmpTarball', () => {
  it('extracts every known entry', () => {
    const result = readPvmpTarball(buildTarball(), 'test.tgz');
    expect(result.packageJson).toMatchObject({ name: '@corp/vsc-lint', version: '1.4.0' });
    expect(result.readme).toBe('# Corp Lint\n');
    expect(result.changelog).toBe('## 1.4.0\n');
    expect(result.vsix).toHaveLength(2048);
    expect(result.icon?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('reads a non-conforming tarball in full rather than failing', () => {
    const result = readPvmpTarball(buildTarball({ metadataFirst: false }), 'test.tgz');
    expect(result.packageJson).toMatchObject({ name: '@corp/vsc-lint' });
    expect(result.vsix).toHaveLength(2048);
  });

  it('omits entries the package does not ship', () => {
    const tarball = buildPvmpTarball({ packageJson: PACKAGE_JSON });
    const result = readPvmpTarball(tarball, 'test.tgz');
    expect(result.vsix).toBeUndefined();
    expect(result.readme).toBeUndefined();
    expect(result.icon).toBeUndefined();
  });

  it('rejects a tarball with no package.json', () => {
    const tarball = buildRawTar([{ name: 'package/README.md', data: encoder.encode('hi') }]);
    expect(() => readPvmpTarball(tarball, 'bad.tgz')).toThrow(ManifestError);
  });

  it('rejects bytes that are not gzip', () => {
    expect(() => readPvmpTarball(encoder.encode('definitely not gzip'), 'bad.tgz')).toThrow(
      /not a gzip archive/,
    );
  });

  it('rejects a package.json that is not valid JSON', () => {
    const tarball = buildRawTar([{ name: 'package/package.json', data: encoder.encode('{ oops') }]);
    expect(() => readPvmpTarball(tarball, 'bad.tgz')).toThrow(/not valid JSON/);
  });
});

/** Streams `bytes` in fixed-size chunks, counting how many are actually pulled. */
function countingStream(bytes: Uint8Array, chunkSize: number) {
  const counter = { delivered: 0 };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.subarray(offset, offset + chunkSize);
      offset += chunk.length;
      counter.delivered += chunk.length;
      controller.enqueue(chunk);
    },
  });
  return { stream, counter };
}

describe('readIconFromStream', () => {
  it('reads the icon out of a stream', async () => {
    const { stream } = countingStream(buildTarball(), 512);
    const icon = await readIconFromStream(stream);
    expect(icon?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('stops pulling once the icon is found, leaving the vsix untransferred', async () => {
    // 512KB of incompressible vsix after the metadata. A conforming package
    // should cost a few KB, not the whole archive.
    const tarball = buildTarball({ vsixBytes: 512 * 1024 });
    const { stream, counter } = countingStream(tarball, 1024);

    const icon = await readIconFromStream(stream);

    expect(icon).toBeDefined();
    expect(tarball.length).toBeGreaterThan(400_000);
    expect(counter.delivered).toBeLessThan(16 * 1024);
  });

  it('fires the abort callback so the caller can cancel the fetch', async () => {
    const abort = new AbortController();
    const { stream } = countingStream(buildTarball(), 512);
    await readIconFromStream(stream, abort);
    expect(abort.signal.aborted).toBe(true);
  });

  it('returns undefined when the package ships no icon', async () => {
    const tarball = buildRawTar([{ name: 'package/package.json', data: encoder.encode('{}') }]);
    const { stream } = countingStream(tarball, 512);
    await expect(readIconFromStream(stream)).resolves.toBeUndefined();
  });
});
