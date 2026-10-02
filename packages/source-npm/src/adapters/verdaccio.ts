import { SourceFailure } from '@pvmp/core';

import { getJson, joinUrl, redactUrl } from '../http.ts';
import type { AdapterContext, CatalogAdapter } from './types.ts';
import { matchesScope } from './types.ts';

interface SearchResponse {
  objects?: { package?: { name?: unknown } }[];
}

const PAGE_SIZE = 250;

/**
 * Verdaccio.
 *
 * Tries `/-/all` first: deprecated, but Verdaccio still serves it, and it
 * returns the whole catalog in one request. Falls back to the paginated
 * `/-/v1/search`. The live integration test runs against this adapter
 * (SPEC.md §4.2).
 */
export const verdaccioAdapter: CatalogAdapter = {
  id: 'verdaccio',

  async listPackages(ctx: AdapterContext): Promise<string[]> {
    const names = (await listViaAll(ctx)) ?? (await listViaSearch(ctx));
    // Verdaccio answers an anonymous listing of a private registry with an
    // empty 200, not a 401, so this is the only sign that a token is missing.
    if (names.length === 0 && !ctx.http.token) {
      throw new SourceFailure(
        ctx.sourceId,
        'auth',
        `${redactUrl(ctx.registry)} listed no packages. If it requires sign-in, sign in to see them.`,
      );
    }
    return names;
  },
};

async function listViaAll(ctx: AdapterContext): Promise<string[] | undefined> {
  try {
    const { value } = await getJson<Record<string, unknown>>(
      joinUrl(ctx.registry, '-/all'),
      ctx.http,
    );
    if (!value) return undefined;

    const names = Object.keys(value).filter(
      (key) => !key.startsWith('_') && key !== 'update' && matchesScope(key, ctx.scope),
    );
    return names.length > 0 ? names : undefined;
  } catch (error) {
    ctx.log.debug(`[${ctx.sourceId}] /-/all unavailable, falling back to search: ${String(error)}`);
    return undefined;
  }
}

/**
 * An empty `text` lists every local package. Verdaccio 5 and 6 ignore the
 * `keywords:` and `scope:` qualifiers, so a qualified query finds nothing,
 * and Verdaccio 5 merges npmjs.org results into any non-empty query.
 */
async function listViaSearch(ctx: AdapterContext): Promise<string[]> {
  const names: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const url = joinUrl(ctx.registry, `-/v1/search?text=&size=${PAGE_SIZE}&from=${from}`);
    // oxlint-disable-next-line no-await-in-loop -- `from` depends on the previous page
    const { value } = await getJson<SearchResponse>(url, ctx.http);

    const page = value?.objects ?? [];
    for (const item of page) {
      const name = item?.package?.name;
      if (typeof name === 'string' && matchesScope(name, ctx.scope)) names.push(name);
    }

    if (page.length < PAGE_SIZE) return names;
  }
}
