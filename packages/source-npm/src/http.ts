import type { Logger } from '@pvmp/core';
import { errorMessage, httpErrorKind, SourceFailure } from '@pvmp/core';

export interface HttpContext {
  sourceId: string;
  log: Logger;
  /** Bearer token, or undefined for an anonymous registry. */
  token: string | undefined;
}

/**
 * `| undefined` on each field is deliberate: under exactOptionalPropertyTypes
 * it is what lets callers write `{ signal: call?.signal }` instead of
 * spreading a conditional object at every call site.
 */
export interface HttpOptions {
  accept?: string | undefined;
  /** Sent as If-None-Match; a 304 resolves to `notModified`. */
  etag?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface HttpResult<T> {
  value: T | undefined;
  etag: string | undefined;
  notModified: boolean;
}

/**
 * Strips any userinfo before a URL reaches a log line or an error message.
 *
 * A registry configured as https://user:pass@host/ would otherwise put those
 * credentials into the output channel and into the error banner the webview
 * renders.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    // Not parseable, so there is no userinfo to strip either.
    return url;
  }
}

function headers(ctx: HttpContext, options: HttpOptions): Record<string, string> {
  const result: Record<string, string> = {
    accept: options.accept ?? 'application/json',
  };
  if (ctx.token) result['authorization'] = `Bearer ${ctx.token}`;
  if (options.etag) result['if-none-match'] = options.etag;
  return result;
}

async function send(url: string, ctx: HttpContext, options: HttpOptions): Promise<Response> {
  ctx.log.trace(`[${ctx.sourceId}] GET ${redactUrl(url)}`);
  try {
    return await fetch(url, {
      headers: headers(ctx, options),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // fetch only rejects for transport-level problems: DNS, TLS, refused,
    // aborted. Anything with a status code comes back as a Response.
    throw new SourceFailure(
      ctx.sourceId,
      'unreachable',
      `Could not reach ${redactUrl(url)}: ${errorMessage(error)}`,
      error,
    );
  }
}

function assertOk(response: Response, url: string, ctx: HttpContext): void {
  if (response.ok || response.status === 304) return;
  throw new SourceFailure(
    ctx.sourceId,
    httpErrorKind(response.status),
    response.status === 401 || response.status === 403
      ? `Sign-in required: ${redactUrl(url)} returned ${response.status} ${response.statusText}.`
      : `${redactUrl(url)} returned ${response.status} ${response.statusText}.`,
  );
}

export async function getJson<T>(
  url: string,
  ctx: HttpContext,
  options: HttpOptions = {},
): Promise<HttpResult<T>> {
  const response = await send(url, ctx, options);
  assertOk(response, url, ctx);

  if (response.status === 304) {
    return { value: undefined, etag: options.etag, notModified: true };
  }

  let value: T;
  try {
    value = (await response.json()) as T;
  } catch (error) {
    throw new SourceFailure(ctx.sourceId, 'parse', `${redactUrl(url)} did not return JSON`, error);
  }

  return { value, etag: response.headers.get('etag') ?? undefined, notModified: false };
}

export async function getBytes(
  url: string,
  ctx: HttpContext,
  options: HttpOptions = {},
): Promise<Uint8Array> {
  const response = await send(url, ctx, { accept: 'application/octet-stream', ...options });
  assertOk(response, url, ctx);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Opens a byte stream, for readers that abort once they have what they need.
 *
 * The AbortController must be the one wired into `options.signal`, so that
 * aborting really cancels the transfer rather than just stopping the reader.
 */
export async function getStream(
  url: string,
  ctx: HttpContext,
  options: HttpOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const response = await send(url, ctx, { accept: 'application/octet-stream', ...options });
  assertOk(response, url, ctx);
  if (!response.body) {
    throw new SourceFailure(
      ctx.sourceId,
      'unreachable',
      `${redactUrl(url)} returned an empty body`,
    );
  }
  return response.body;
}

/** Joins a base URL and a path without doubling or dropping the separator. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
