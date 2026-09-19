import type { PvmpPackageJson } from '@pvmp/core';

/** One version entry in a packument: the published package.json plus `dist`. */
export interface PackumentVersion extends PvmpPackageJson {
  dist?: {
    tarball?: string;
    integrity?: string;
    shasum?: string;
  };
}

/**
 * An npm packument.
 *
 * This is the reason extensions are npm packages: one request returns every
 * version's complete package.json plus publish times, so listing a catalog
 * needs no tarball downloads at all (SPEC.md §2).
 */
export interface Packument {
  name?: string;
  versions?: Record<string, PackumentVersion>;
  time?: Record<string, string>;
  'dist-tags'?: Record<string, string>;
}

export interface PackumentEntry {
  version: string;
  manifest: PackumentVersion;
  tarball: string;
  /** sha512 integrity, or a sha1 shasum, whichever the registry supplies. */
  integrity: string | undefined;
  publishedAt: string | undefined;
}

/** Pulls out the versions that are actually usable, ignoring malformed ones. */
export function packumentEntries(packument: Packument): PackumentEntry[] {
  const entries: PackumentEntry[] = [];

  for (const [version, manifest] of Object.entries(packument.versions ?? {})) {
    const tarball = manifest?.dist?.tarball;
    if (typeof tarball !== 'string' || tarball.length === 0) continue;

    entries.push({
      version,
      manifest,
      tarball,
      integrity: manifest.dist?.integrity ?? manifest.dist?.shasum,
      publishedAt: packument.time?.[version],
    });
  }

  return entries;
}

/** Only packages carrying a `pvmp` block are ours; the rest of the registry is not. */
export function isPvmpPackage(manifest: PackumentVersion): boolean {
  const block = manifest.pvmp;
  return typeof block === 'object' && block !== null && !Array.isArray(block);
}

/** npm requires the scope separator to be percent-encoded in a path. */
export function encodePackageName(name: string): string {
  return name.replace('/', '%2f');
}
