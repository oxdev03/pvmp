import { SourceFailure } from '@pvmp/core';

import { getJson, isBasicCredential, joinUrl } from '../http.ts';
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
 * `continuationToken`. Works for hosted and group repositories. Tested live
 * against Nexus 3.96 Community Edition (SPEC.md §4.2).
 *
 * The REST API rejects npm Bearer tokens, which only the npm endpoints
 * accept, so a private Nexus needs `username:password` (SPEC.md §4.3).
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
      let value: ComponentsResponse | undefined;
      try {
        // oxlint-disable-next-line no-await-in-loop -- the cursor comes from the previous page
        ({ value } = await getJson<ComponentsResponse>(url, ctx.http));
      } catch (error) {
        throw explainBearer(error, ctx);
      }

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

/** A 401 after signing in with an npm token needs a different fix than a missing sign-in. */
function explainBearer(error: unknown, ctx: AdapterContext): unknown {
  const token = ctx.http.token;
  if (!(error instanceof SourceFailure) || error.kind !== 'auth') return error;
  if (!token || isBasicCredential(token)) return error;
  return new SourceFailure(
    ctx.sourceId,
    'auth',
    `${error.message} Nexus's REST API does not accept npm tokens. Sign in with username:password instead.`,
    error,
  );
}

/**
 * Nexus stores a scoped npm name as a group plus a name. Nexus 3.96 reports
 * `@corp/vsc-lint` as group `corp` (no `@`) and name `vsc-lint`; an unscoped
 * package has group `""`. The `@` form is accepted too.
 */
export function qualifiedName(item: { name?: unknown; group?: unknown }): string | undefined {
  const name = typeof item?.name === 'string' ? item.name : undefined;
  if (!name) return undefined;
  const group = typeof item?.group === 'string' && item.group.length > 0 ? item.group : undefined;
  if (!group) return name;
  const scope = group.startsWith('@') ? group : `@${group}`;
  return name.startsWith(`${scope}/`) ? name : `${scope}/${name}`;
}
