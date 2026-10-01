import { gzipSync } from 'fflate';
import { createTar } from 'nanotar';

import type { PvmpPackageJson } from './manifest.ts';

const encoder = new TextEncoder();

export interface TarballFixture {
  packageJson: PvmpPackageJson;
  readme?: string;
  changelog?: string;
  icon?: Uint8Array;
  vsix?: Uint8Array;
  /** Put extension.vsix first, violating SPEC.md §2.1, to test the slow path. */
  vsixFirst?: boolean;
  /** Extra entries, for malformed-package tests. */
  extra?: { name: string; data: Uint8Array }[];
}

export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Deterministic pseudo-random bytes.
 *
 * A real vsix is a zip and does not compress. A constant-filled fixture would
 * gzip to almost nothing, and tests that count transferred bytes would pass
 * for the wrong reason.
 */
export function incompressibleBytes(length: number, seed = 0x2545_f491): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

/** Builds an npm tarball laid out in the pvmp format (SPEC.md §2). */
export function buildPvmpTarball(fixture: TarballFixture): Uint8Array {
  const metadata: { name: string; data: Uint8Array }[] = [
    { name: 'package/package.json', data: encoder.encode(JSON.stringify(fixture.packageJson)) },
  ];
  if (fixture.icon) metadata.push({ name: 'package/icon.png', data: fixture.icon });
  if (fixture.readme) {
    metadata.push({ name: 'package/README.md', data: encoder.encode(fixture.readme) });
  }
  if (fixture.changelog) {
    metadata.push({ name: 'package/CHANGELOG.md', data: encoder.encode(fixture.changelog) });
  }
  metadata.push(...(fixture.extra ?? []));

  const files = fixture.vsix
    ? fixture.vsixFirst
      ? [{ name: 'package/extension.vsix', data: fixture.vsix }, ...metadata]
      : [...metadata, { name: 'package/extension.vsix', data: fixture.vsix }]
    : metadata;

  return gzipSync(createTar(files));
}

/** An arbitrary gzipped tar, for malformed-archive tests. */
export function buildRawTar(files: { name: string; data: Uint8Array }[]): Uint8Array {
  return gzipSync(createTar(files));
}

/** A conforming package.json for the pvmp format. */
export function packageJsonFixture(overrides: Partial<PvmpPackageJson> = {}): PvmpPackageJson {
  return {
    name: '@corp/vsc-lint',
    version: '1.4.0',
    description: 'Lints things',
    categories: ['Linters'],
    engines: { vscode: '^1.96.0' },
    repository: { url: 'https://github.com/acme/lint' },
    pvmp: {
      extensionId: 'acme.lint',
      displayName: 'Corp Lint',
      publisherDisplayName: 'Acme',
      targetPlatform: 'universal',
      preRelease: false,
    },
    ...overrides,
  };
}
