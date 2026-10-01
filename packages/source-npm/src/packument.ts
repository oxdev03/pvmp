import type { PvmpPackageJson } from '@pvmp/core';
import { isRecord } from '@pvmp/core';

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
 * One request returns every version's package.json and publish time, so the
 * catalog lists without downloading any tarball. This is why extensions ship
 * as npm packages (SPEC.md §2).
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

/** The versions that have a tarball URL; malformed entries are skipped. */
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

/** True for packages with a `pvmp` block. Everything else in the registry is ignored. */
export function isPvmpPackage(manifest: PackumentVersion): boolean {
  return isRecord(manifest.pvmp);
}

/** npm requires the scope separator to be percent-encoded in a path. */
export function encodePackageName(name: string): string {
  return name.replace('/', '%2f');
}
