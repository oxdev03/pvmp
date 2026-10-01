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
 * Lists the packages in a registry, which the npm protocol has no portable
 * way to do. NpmSource handles packuments, tarballs and auth (SPEC.md §3.2).
 */
export interface CatalogAdapter {
  readonly id: string;
  listPackages(ctx: AdapterContext): Promise<string[]>;
}

/**
 * Splits a registry URL shaped `<base><marker><repo>/` into the product's base
 * URL and repository name. `baseUrl` and `repo` settings take precedence.
 *
 * `https://art.corp/artifactory/api/npm/npm-local/` with marker `/api/npm/`
 * gives `https://art.corp/artifactory` and `npm-local`.
 */
export function locateRepository(
  ctx: AdapterContext,
  adapterId: string,
  marker: string,
): { base: string; repo: string } {
  const index = ctx.registry.indexOf(marker);
  const derivedBase =
    index === -1 ? ctx.registry.replace(/\/+$/, '') : ctx.registry.slice(0, index);
  const derivedRepo =
    index === -1 ? '' : (ctx.registry.slice(index + marker.length).split('/')[0] ?? '');

  const repo = ctx.repo ?? derivedRepo;
  if (!repo) {
    throw new Error(
      `${adapterId} source ${ctx.sourceId} needs "repo", or a registry URL ending in ${marker}<repo>/`,
    );
  }
  return { base: ctx.baseUrl ?? derivedBase, repo };
}

export function matchesScope(name: string, scope: string | undefined): boolean {
  if (!scope) return true;
  const prefix = scope.endsWith('/') ? scope : `${scope}/`;
  return name.startsWith(prefix);
}
