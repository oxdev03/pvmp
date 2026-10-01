import type { Logger, SourceDeps } from '@pvmp/core';
import { BlobCache, createMemoryFileStore } from '@pvmp/core';

export const silentLog: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function makeDeps(token?: string): SourceDeps {
  const files = createMemoryFileStore();
  return {
    log: silentLog,
    cache: new BlobCache(files, 'cache'),
    files,
    getToken: () => Promise.resolve(token),
    resolvePath: (input) => input,
  };
}

export interface RouteResponse {
  status?: number;
  json?: unknown;
  body?: Uint8Array;
  etag?: string;
  headers?: Record<string, string>;
}

export interface FetchRecorder {
  /** Every requested URL, in order. */
  urls: string[];
  /** Headers of each request, in order. */
  headers: Record<string, string>[];
}

/**
 * A fetch stub that matches routes by exact URL or prefix. JFrog and Nexus
 * are tested only this way (SPEC.md §17).
 */
export function stubFetch(
  routes: Record<string, RouteResponse | ((url: string) => RouteResponse)>,
): { fetch: typeof globalThis.fetch; recorder: FetchRecorder } {
  const recorder: FetchRecorder = { urls: [], headers: [] };

  type FetchInput = Parameters<typeof globalThis.fetch>[0];
  type FetchInit = Parameters<typeof globalThis.fetch>[1];
  type ResponseBody = ConstructorParameters<typeof Response>[0];

  const impl = (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    recorder.urls.push(url);
    recorder.headers.push({ ...(init?.headers as Record<string, string> | undefined) });

    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    const key = Object.keys(routes)
      .filter((pattern) => url === pattern || url.startsWith(pattern))
      .toSorted((a, b) => b.length - a.length)[0];

    if (!key) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }

    const entry = routes[key];
    const route = typeof entry === 'function' ? entry(url) : (entry as RouteResponse);
    const status = route.status ?? 200;
    const headers = new Headers(route.headers ?? {});
    if (route.etag) headers.set('etag', route.etag);

    // If-None-Match honoured, so ETag revalidation can be asserted.
    const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['if-none-match'];
    if (ifNoneMatch && route.etag && ifNoneMatch === route.etag) {
      return Promise.resolve(new Response(null, { status: 304, headers }));
    }

    if (status >= 400) {
      return Promise.resolve(new Response('error', { status, headers }));
    }

    if (route.body) {
      return Promise.resolve(
        new Response(route.body as unknown as ResponseBody, { status, headers }),
      );
    }

    headers.set('content-type', 'application/json');
    return Promise.resolve(new Response(JSON.stringify(route.json ?? {}), { status, headers }));
  };

  return { fetch: impl as unknown as typeof globalThis.fetch, recorder };
}
