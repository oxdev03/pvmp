import { getJson, joinUrl } from '../http.ts';
import type { AdapterContext, CatalogAdapter } from './types.ts';
import { locateRepository, matchesScope } from './types.ts';

export const JFROG_MARKER = '/api/npm/';

interface StorageListing {
  files?: { uri?: unknown; folder?: unknown }[];
}

/**
 * JFrog Artifactory, via the storage listing API.
 *
 * `GET /api/storage/<repo>?list&deep=1` returns every file URI in the repo.
 * In an npm repo they look like `/@corp/vsc-lint/-/vsc-lint-1.4.0.tgz`, and
 * the package name is the path before `/-/`.
 *
 * The storage API needs only read permission on the repo. AQL, the
 * alternative, often needs more on locked-down instances.
 *
 * Tested against recorded responses only (SPEC.md §17).
 */
export const jfrogAdapter: CatalogAdapter = {
  id: 'jfrog',

  async listPackages(ctx: AdapterContext): Promise<string[]> {
    const { base, repo } = locateRepository(ctx, 'jfrog', JFROG_MARKER);

    const url = joinUrl(base, `api/storage/${repo}?list&deep=1&listFolders=0&mdTimestamps=0`);
    const { value } = await getJson<StorageListing>(url, ctx.http);

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
