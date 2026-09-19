import { getJson, joinUrl } from '../http.ts';
import type { AdapterContext, CatalogAdapter } from './types.ts';
import { matchesScope } from './types.ts';

interface ComponentsResponse {
  items?: { name?: unknown; group?: unknown; format?: unknown }[];
  continuationToken?: unknown;
}

/**
 * Sonatype Nexus, via the components REST API.
 *
 * `GET /service/rest/v1/components?repository=<repo>` is cursor-paginated
 * through `continuationToken`. For npm components Nexus splits a scoped name
 * into `group` (`@corp`) and `name` (`vsc-lint`).
 *
 * Fixture-verified, not live-verified (SPEC.md §17).
 */
export const nexusAdapter: CatalogAdapter = {
  id: 'nexus',

  async listPackages(ctx: AdapterContext): Promise<string[]> {
    const base = ctx.baseUrl ?? deriveBaseUrl(ctx.registry);
    const repo = ctx.repo ?? deriveRepo(ctx.registry);
    if (!repo) {
      throw new Error(
        `nexus source ${ctx.sourceId} needs "repo", or a registry URL ending in /repository/<repo>/`,
      );
    }

    const names = new Set<string>();
    let token: string | undefined;
    // Bounded so a registry that keeps handing back a token cannot spin forever.
    for (let page = 0; page < 200; page++) {
      const url = joinUrl(
        base,
        `service/rest/v1/components?repository=${encodeURIComponent(repo)}${
          token ? `&continuationToken=${encodeURIComponent(token)}` : ''
        }`,
      );
      // oxlint-disable-next-line no-await-in-loop -- the cursor comes from the previous page
      const { value } = await getJson<ComponentsResponse>(url, ctx.http, { signal: ctx.signal });

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

/** `https://nexus.corp/repository/npm-hosted/` -> `https://nexus.corp` */
export function deriveBaseUrl(registry: string): string {
  const index = registry.indexOf('/repository/');
  return index === -1 ? registry.replace(/\/+$/, '') : registry.slice(0, index);
}

/** `https://nexus.corp/repository/npm-hosted/` -> `npm-hosted` */
export function deriveRepo(registry: string): string | undefined {
  const match = /\/repository\/([^/]+)/.exec(registry);
  return match?.[1];
}
