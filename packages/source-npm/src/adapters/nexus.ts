import { getJson, joinUrl } from '../http.ts';
import type { AdapterContext, CatalogAdapter } from './types.ts';
import { locateRepository, matchesScope } from './types.ts';

export const NEXUS_MARKER = '/repository/';

interface ComponentsResponse {
  items?: { name?: unknown; group?: unknown; format?: unknown }[];
  continuationToken?: unknown;
}

/**
 * Sonatype Nexus, via the components REST API.
 *
 * `GET /service/rest/v1/components?repository=<repo>`, paginated by
 * `continuationToken`.
 *
 * Tested against recorded responses only (SPEC.md §17).
 */
export const nexusAdapter: CatalogAdapter = {
  id: 'nexus',

  async listPackages(ctx: AdapterContext): Promise<string[]> {
    const { base, repo } = locateRepository(ctx, 'nexus', NEXUS_MARKER);

    const names = new Set<string>();
    let token: string | undefined;
    // Capped, in case a registry keeps returning a token.
    for (let page = 0; page < 200; page++) {
      const url = joinUrl(
        base,
        `service/rest/v1/components?repository=${encodeURIComponent(repo)}${
          token ? `&continuationToken=${encodeURIComponent(token)}` : ''
        }`,
      );
      // oxlint-disable-next-line no-await-in-loop -- the cursor comes from the previous page
      const { value } = await getJson<ComponentsResponse>(url, ctx.http);

      for (const item of value?.items ?? []) {
        const name = qualifiedName(item);
        if (name && matchesScope(name, ctx.scope)) names.add(name);
      }

      const next = value?.continuationToken;
      if (typeof next !== 'string' || next.length === 0) break;
      token = next;
    }

    return [...names];
  },
};

/** Nexus stores a scoped npm name as group `@corp` plus name `vsc-lint`. */
export function qualifiedName(item: { name?: unknown; group?: unknown }): string | undefined {
  const name = typeof item?.name === 'string' ? item.name : undefined;
  if (!name) return undefined;
  const group = typeof item?.group === 'string' && item.group.length > 0 ? item.group : undefined;
  if (!group) return name;
  return name.startsWith(`${group}/`) ? name : `${group}/${name}`;
}
