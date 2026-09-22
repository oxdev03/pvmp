import { gunzipSync } from 'fflate';
import { parseTar } from 'nanotar';

import { ManifestError } from './errors.ts';
import type { PvmpPackageJson } from './manifest.ts';
import { isRecord } from './manifest.ts';
import { normalizeEntryName, readTarGzipStream } from './tar.ts';

/** Entry names inside a pvmp package, after `package/` is stripped. */
export const ENTRY = {
  packageJson: 'package.json',
  vsix: 'extension.vsix',
  readme: 'readme.md',
  changelog: 'changelog.md',
  icon: 'icon.png',
} as const;

/** Just enough of the package to render a details page and install it. */
export interface PvmpTarball {
  packageJson: PvmpPackageJson;
  vsix?: Uint8Array;
  readme?: string;
  changelog?: string;
  icon?: Uint8Array;
}

const decoder = new TextDecoder();

function parsePackageJson(bytes: Uint8Array, locator: string): PvmpPackageJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new ManifestError(locator, `package.json is not valid JSON: ${String(error)}`);
  }
  if (!isRecord(parsed)) throw new ManifestError(locator, 'package.json is not an object');
  return parsed;
}

/** Reads a complete npm tarball already held in memory. */
export function readPvmpTarball(bytes: Uint8Array, locator: string): PvmpTarball {
  let tar: Uint8Array;
  try {
    tar = gunzipSync(bytes);
  } catch (error) {
    throw new ManifestError(locator, `not a gzip archive: ${String(error)}`);
  }

  const found = new Map<string, Uint8Array>();
  for (const item of parseTar(tar)) {
    if (!item.data) continue;
    found.set(normalizeEntryName(item.name), item.data);
  }

  const packageJsonBytes = found.get(ENTRY.packageJson);
  if (!packageJsonBytes) {
    throw new ManifestError(locator, 'tarball contains no package.json');
  }

  const readme = found.get(ENTRY.readme);
  const changelog = found.get(ENTRY.changelog);
  const vsix = found.get(ENTRY.vsix);
  const icon = found.get(ENTRY.icon);

  return {
    packageJson: parsePackageJson(packageJsonBytes, locator),
    ...(vsix ? { vsix } : {}),
    ...(readme ? { readme: decoder.decode(readme) } : {}),
    ...(changelog ? { changelog: decoder.decode(changelog) } : {}),
    ...(icon ? { icon } : {}),
  };
}

/** The installable payload; a package without one is not a pvmp package. */
export function readVsix(bytes: Uint8Array, locator: string): Uint8Array {
  const { vsix } = readPvmpTarball(bytes, locator);
  if (!vsix) throw new ManifestError(locator, 'tarball contains no extension.vsix');
  return vsix;
}

/**
 * Pulls only the icon out of a tarball stream.
 *
 * pvmp's format requires metadata entries to precede `extension.vsix`
 * (SPEC.md §2.1), so for a conforming package this reads a few KB and then
 * aborts. A non-conforming package still works, it just transfers in full.
 */
export async function readIconFromStream(
  stream: ReadableStream<Uint8Array>,
  abort?: AbortController,
): Promise<Uint8Array | undefined> {
  const entries = await readTarGzipStream(stream, [ENTRY.icon], () => abort?.abort());
  return entries.get(ENTRY.icon);
}
