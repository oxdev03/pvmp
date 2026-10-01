import { getJson, joinUrl } from '../http.ts';
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
    const fromAll = await listViaAll(ctx);
    if (fromAll) return fromAll;
    return listViaSearch(ctx);
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

async function listViaSearch(ctx: AdapterContext): Promise<string[]> {
  const names: string[] = [];
  const text = ctx.scope ? `scope:${ctx.scope.replace('@', '')}` : 'keywords:vscode-extension';

  for (let from = 0; ; from += PAGE_SIZE) {
    const url = joinUrl(
      ctx.registry,
      `-/v1/search?text=${encodeURIComponent(text)}&size=${PAGE_SIZE}&from=${from}`,
    );
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
