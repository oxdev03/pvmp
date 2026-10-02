import type { ExtensionVersion } from '@pvmp/contract';
import type {
  ExtensionDetailContent,
  RawSourceConfig,
  SourceDeps,
  SourceFactory,
  SourceProvider,
} from '@pvmp/core';
import {
  extractContent,
  ManifestError,
  nonEmptyString,
  readIconFromStream,
  readPvmpTarball,
  readVsix,
  SourceFailure,
  toExtensionVersion,
} from '@pvmp/core';

import type { AdapterContext, CatalogAdapter } from './adapters/index.ts';
import { CATALOG_ADAPTERS, detectAdapter } from './adapters/index.ts';
import type { HttpContext } from './http.ts';
import { getBytes, getJson, getStream, joinUrl, redactUrl, sameOrigin } from './http.ts';
import type { Packument } from './packument.ts';
import {
  encodePackageName,
  isPvmpPackage,
  matchesIntegrity,
  packumentEntries,
} from './packument.ts';

export const NPM_SOURCE_TYPE = 'npm';

export interface NpmSourceConfig {
  id: string;
  registry: string;
  adapter: CatalogAdapter;
  scope: string | undefined;
  repo: string | undefined;
  baseUrl: string | undefined;
}

interface CachedPackument {
  etag: string | undefined;
  packument: Packument;
}

/**
 * Extensions published as npm packages, from any registry.
 *
 * Uses only the npm protocol, which JFrog, Nexus and Verdaccio all serve the
 * same way. Listing the catalog is the adapter's job (SPEC.md §3.2).
 */
export class NpmSource implements SourceProvider {
  /** Tarball URL to the integrity its packument published, filled by list(). */
  readonly #integrity = new Map<string, string>();

  constructor(
    private readonly config: NpmSourceConfig,
    private readonly deps: SourceDeps,
  ) {}

  get id(): string {
    return this.config.id;
  }

  async #http(): Promise<HttpContext> {
    return {
      sourceId: this.id,
      log: this.deps.log,
      token: await this.deps.getToken(this.id),
    };
  }

  /**
   * For tarball URLs, which the packument supplies. Like npm, pvmp sends the
   * token only to the registry it was configured for, never to another host.
   */
  async #tarballHttp(url: string): Promise<HttpContext> {
    const http = await this.#http();
    return sameOrigin(url, this.config.registry) ? http : { ...http, token: undefined };
  }

  async list(): Promise<ExtensionVersion[]> {
    const http = await this.#http();
    const adapterCtx: AdapterContext = {
      sourceId: this.id,
      log: this.deps.log,
      http,
      registry: this.config.registry,
      scope: this.config.scope,
      repo: this.config.repo,
      baseUrl: this.config.baseUrl,
    };

    let names: string[];
    try {
      names = await this.config.adapter.listPackages(adapterCtx);
    } catch (error) {
      if (error instanceof SourceFailure) throw error;
      throw new SourceFailure(this.id, 'config', String(error), error);
    }

    this.deps.log.debug(`[${this.id}] ${this.config.adapter.id} listed ${names.length} package(s)`);

    // One bad packument skips that package, not the whole catalog.
    const settled = await Promise.all(
      names.map(async (name) => {
        try {
          return await this.#versionsOf(name, http);
        } catch (error) {
          // A missing sign-in fails every package alike; report it once, with
          // the banner's Sign in button, rather than as an empty catalog.
          if (error instanceof SourceFailure && error.kind === 'auth') throw error;
          this.deps.log.warn(`[${this.id}] skipping ${name}: ${String(error)}`);
          return [];
        }
      }),
    );

    return settled.flat();
  }

  async #versionsOf(name: string, http: HttpContext): Promise<ExtensionVersion[]> {
    const packument = await this.#packument(name, http);
    const versions: ExtensionVersion[] = [];

    for (const entry of packumentEntries(packument)) {
      if (!isPvmpPackage(entry.manifest)) continue;
      if (entry.integrity) this.#integrity.set(entry.tarball, entry.integrity);
      try {
        versions.push(
          toExtensionVersion(entry.manifest, {
            sourceId: this.id,
            locator: entry.tarball,
            ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
          }),
        );
      } catch (error) {
        if (error instanceof ManifestError) {
          this.deps.log.warn(`[${this.id}] ${name}@${entry.version}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }

    return versions;
  }

  /** Revalidated by ETag, so an unchanged packument costs a 304. */
  async #packument(name: string, http: HttpContext): Promise<Packument> {
    const key = `packument:${this.id}:${name}`;
    const cached = await this.deps.cache.getJson<CachedPackument>(key);
    const url = joinUrl(this.config.registry, encodePackageName(name));

    const { value, etag } = await getJson<Packument>(url, http, {
      etag: cached?.etag,
    });

    // A 304 carries no body, so it lands here too.
    if (!value) {
      if (cached) return cached.packument;
      throw new SourceFailure(this.id, 'parse', `${redactUrl(url)} returned no packument`);
    }

    await this.deps.cache.putJson(key, { etag, packument: value } satisfies CachedPackument);
    return value;
  }

  /** Full tarball read, cached, for readme and changelog. */
  async fetchDetails(version: ExtensionVersion): Promise<ExtensionDetailContent> {
    const key = this.#key(version);
    const cached = await this.deps.cache.getJson<ExtensionDetailContent>(`details:${key}`);
    if (cached) return cached;

    const http = await this.#tarballHttp(version.locator);
    const tarball = readPvmpTarball(await getBytes(version.locator, http), version.locator);
    const content = await extractContent(tarball, this.deps.cache, key);
    await this.deps.cache.putJson(`details:${key}`, content);
    return content;
  }

  async fetchIcon(version: ExtensionVersion): Promise<Uint8Array | undefined> {
    const key = this.#key(version);
    const cached = await this.deps.cache.get('icon', key);
    if (cached) return cached;

    // Streams the tarball and aborts once icon.png is complete: a few KB for a
    // package in SPEC.md §2.1 order, the full download for any other.
    const abort = new AbortController();
    const http = await this.#tarballHttp(version.locator);

    let icon: Uint8Array | undefined;
    try {
      const stream = await getStream(version.locator, http, { signal: abort.signal });
      icon = await readIconFromStream(stream, abort);
    } catch (error) {
      // Our own abort means we got the icon.
      if (!abort.signal.aborted) {
        this.deps.log.debug(`[${this.id}] no icon for ${version.extensionId}: ${String(error)}`);
        return undefined;
      }
    }

    if (icon) await this.deps.cache.put('icon', key, icon);
    return icon;
  }

  async fetchVsix(version: ExtensionVersion): Promise<Uint8Array> {
    const bytes = await getBytes(version.locator, await this.#tarballHttp(version.locator));
    const integrity = this.#integrity.get(version.locator);
    if (integrity && !(await matchesIntegrity(bytes, integrity))) {
      throw new SourceFailure(
        this.id,
        'parse',
        `${redactUrl(version.locator)} does not match the integrity hash its registry published`,
      );
    }
    return readVsix(bytes, version.locator);
  }

  #key(version: ExtensionVersion): string {
    return `${this.id}:${version.packageName}@${version.version}`;
  }
}

export const npmSourceFactory: SourceFactory = {
  type: NPM_SOURCE_TYPE,

  create(config: RawSourceConfig, deps: SourceDeps): SourceProvider {
    const id = nonEmptyString(config.id) ?? NPM_SOURCE_TYPE;
    const known = Object.keys(CATALOG_ADAPTERS).join(', ');

    const registry = nonEmptyString(config.registry);
    if (!registry) throw new SourceFailure(id, 'config', 'npm source requires a "registry" URL');
    // fetch rejects such URLs outright, and settings are no place for secrets.
    if (redactUrl(registry) !== registry) {
      throw new SourceFailure(
        id,
        'config',
        `"registry" must not contain credentials. Remove them from ${redactUrl(registry)} and use Sign in to Source.`,
      );
    }

    const requested = nonEmptyString(config.adapter);
    const named = requested ? CATALOG_ADAPTERS[requested] : undefined;
    if (requested && !named) {
      throw new SourceFailure(
        id,
        'config',
        `unknown adapter "${requested}"; expected one of ${known}`,
      );
    }

    const adapter = named ?? detectAdapter(registry);
    if (!adapter) {
      throw new SourceFailure(
        id,
        'config',
        `could not infer a catalog adapter from "${redactUrl(registry)}"; set "adapter" to one of ${known}`,
      );
    }

    return new NpmSource(
      {
        id,
        registry: deps.resolvePath(registry),
        adapter,
        scope: nonEmptyString(config.scope),
        repo: nonEmptyString(config.repo),
        baseUrl: nonEmptyString(config.baseUrl),
      },
      deps,
    );
  },
};
