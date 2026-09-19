import { getJson, joinUrl } from '../http.ts';
import type { AdapterContext, CatalogAdapter } from './types.ts';
import { matchesScope } from './types.ts';

interface StorageListing {
  files?: { uri?: unknown; folder?: unknown }[];
}

/**
 * JFrog Artifactory, via the storage listing API.
 *
 * `GET /api/storage/<repo>?list&deep=1` walks the repository and returns every
 * file URI. For an npm repo those look like `/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz`,
 * so the package name is the path above `/-/`.
 *
 * Chosen over AQL because the storage API needs only read permission on the
 * repository, while AQL often needs more in locked-down installs.
 *
 * Fixture-verified, not live-verified (SPEC.md §17).
 */
export const jfrogAdapter: CatalogAdapter = {
  id: 'jfrog',

  async listPackages(ctx: AdapterContext): Promise<string[]> {
    const base = ctx.baseUrl ?? deriveBaseUrl(ctx.registry);
    const repo = ctx.repo ?? deriveRepo(ctx.registry);
    if (!repo) {
      throw new Error(
        `jfrog source ${ctx.sourceId} needs "repo", or a registry URL ending in /api/npm/<repo>/`,
      );
    }

    const url = joinUrl(base, `api/storage/${repo}?list&deep=1&listFolders=0&mdTimestamps=0`);
    const { value } = await getJson<StorageListing>(url, ctx.http, { signal: ctx.signal });

    const names = new Set<string>();
    for (const file of value?.files ?? []) {
      if (file?.folder === true) continue;
      const uri = typeof file?.uri === 'string' ? file.uri : undefined;
      if (!uri?.endsWith('.tgz')) continue;

      const name = packageNameFromTarballPath(uri);
      if (name && matchesScope(name, ctx.scope)) names.add(name);
    }

    return [...names];
  },
};

/**
 * `/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz` -> `@corp/vsc-lint`
 * `/vsc-lint/-/vsc-lint-1.4.0.tgz`       -> `vsc-lint`
 */
export function packageNameFromTarballPath(uri: string): string | undefined {
  const path = uri.replace(/^\/+/, '');
  const marker = path.lastIndexOf('/-/');
  if (marker <= 0) return undefined;
  return path.slice(0, marker);
}

/** `https://art.corp/artifactory/api/npm/npm-local/` -> `https://art.corp/artifactory` */
export function deriveBaseUrl(registry: string): string {
  const index = registry.indexOf('/api/npm/');
  return index === -1 ? registry.replace(/\/+$/, '') : registry.slice(0, index);
}

/** `https://art.corp/artifactory/api/npm/npm-local/` -> `npm-local` */
export function deriveRepo(registry: string): string | undefined {
  const match = /\/api\/npm\/([^/]+)/.exec(registry);
  return match?.[1];
}
