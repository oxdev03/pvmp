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

const DIGESTS: Record<string, string> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
};

async function digest(algorithm: string, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
}

/**
 * Checks a download against the packument's `dist.integrity` (SRI, such as
 * `sha512-<base64>`) or legacy `dist.shasum` (hex SHA-1). Every hash with a
 * known algorithm must match. A value with none passes, because there is
 * nothing to check against.
 */
export async function matchesIntegrity(bytes: Uint8Array, integrity: string): Promise<boolean> {
  if (/^[\da-f]{40}$/i.test(integrity)) {
    const hex = Array.from(await digest('SHA-1', bytes), (b) => b.toString(16).padStart(2, '0'));
    return hex.join('') === integrity.toLowerCase();
  }

  for (const hash of integrity.trim().split(/\s+/)) {
    const dash = hash.indexOf('-');
    const algorithm = DIGESTS[hash.slice(0, dash)];
    if (dash === -1 || !algorithm) continue;
    // Drops SRI options such as `?foo`, which follow the base64.
    const expected = hash.slice(dash + 1).split('?')[0];
    // oxlint-disable-next-line no-await-in-loop -- usually exactly one hash
    const actual = btoa(String.fromCharCode(...(await digest(algorithm, bytes))));
    if (actual !== expected) return false;
  }
  return true;
}

/** npm requires the scope separator to be percent-encoded in a path. */
export function encodePackageName(name: string): string {
  return name.replace('/', '%2f');
}
