import type { Logger } from '@pvmp/core';

import type { HttpContext } from '../http.ts';

export interface AdapterContext {
  sourceId: string;
  log: Logger;
  http: HttpContext;
  /** The npm registry endpoint, e.g. https://art.corp/artifactory/api/npm/npm-local/ */
  registry: string;
  /** Only list packages under this scope, e.g. `@corp`. */
  scope: string | undefined;
  /** Repository name, for registries whose listing API is not the npm one. */
  repo: string | undefined;
  /** Base URL of the product, when it differs from `registry`. */
  baseUrl: string | undefined;
}

/**
 * Supplies the one thing npm's protocol cannot: which packages exist.
 *
 * Everything else — packuments, tarballs, auth, version resolution — is
 * identical across registries and lives in NpmSource (SPEC.md §3.2).
 */
export interface CatalogAdapter {
  readonly id: string;
  listPackages(ctx: AdapterContext): Promise<string[]>;
}

export function matchesScope(name: string, scope: string | undefined): boolean {
  if (!scope) return true;
  const prefix = scope.endsWith('/') ? scope : `${scope}/`;
  return name.startsWith(prefix);
}
