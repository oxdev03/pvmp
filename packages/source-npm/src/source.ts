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
  readIconFromStream,
  readPvmpTarball,
  SourceFailure,
  toExtensionVersion,
} from '@pvmp/core';

import type { AdapterContext, CatalogAdapter } from './adapters/index.ts';
import { CATALOG_ADAPTERS, detectAdapter } from './adapters/index.ts';
import type { HttpContext } from './http.ts';
import { getBytes, getJson, getStream, joinUrl, redactUrl } from './http.ts';
import type { Packument } from './packument.ts';
import { encodePackageName, isPvmpPackage, packumentEntries } from './packument.ts';

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

interface CachedContent {
  content: ExtensionDetailContent;
}

/**
 * Extensions published as npm packages, from any registry.
 *
 * Everything here is plain npm protocol and therefore identical across JFrog,
 * Nexus and Verdaccio. Only catalog listing differs, and that is the adapter's
 * whole job (SPEC.md §3.2).
 */
export class NpmSource implements SourceProvider {
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

    // Packuments are independent; one bad package must not sink the catalog.
    const settled = await Promise.all(
      names.map(async (name) => {
        try {
          return await this.#versionsOf(name, http);
        } catch (error) {
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

  /** ETag-revalidated: unchanged packuments cost a 304, not a re-parse. */
  async #packument(name: string, http: HttpContext): Promise<Packument> {
    const key = `packument:${this.id}:${name}`;
    const cached = await this.deps.cache.getJson<CachedPackument>(key);
    const url = joinUrl(this.config.registry, encodePackageName(name));

    const { value, etag, notModified } = await getJson<Packument>(url, http, {
      etag: cached?.etag,
    });

    if (notModified && cached) return cached.packument;
    if (!value) {
      if (cached) return cached.packument;
      throw new SourceFailure(this.id, 'parse', `${redactUrl(url)} returned no packument`);
    }

    await this.deps.cache.putJson(key, { etag, packument: value } satisfies CachedPackument);
    return value;
  }

  async fetchDetails(version: ExtensionVersion): Promise<ExtensionDetailContent> {
    return (await this.#content(version)).content;
  }

  async fetchIcon(version: ExtensionVersion): Promise<Uint8Array | undefined> {
    const key = this.#key(version);
    const cached = await this.deps.cache.get('icon', key);
    if (cached) return cached;

    // Stream and abort as soon as icon.png is complete. A tarball laid out per
    // SPEC.md §2.1 costs a few KB; one that is not degrades to a full download.
    const abort = new AbortController();
    const http = await this.#http();

    let icon: Uint8Array | undefined;
    try {
      const stream = await getStream(version.locator, http, { signal: abort.signal });
      icon = await readIconFromStream(stream, abort);
    } catch (error) {
      // An abort we caused is success, not failure.
      if (!abort.signal.aborted) {
        this.deps.log.debug(`[${this.id}] no icon for ${version.extensionId}: ${String(error)}`);
        return undefined;
      }
    }

    if (icon) await this.deps.cache.put('icon', key, icon);
    return icon;
  }

  async fetchVsix(version: ExtensionVersion): Promise<Uint8Array> {
    const http = await this.#http();
    const bytes = await getBytes(version.locator, http, {});

    const tarball = readPvmpTarball(bytes, version.locator);
    if (!tarball.vsix) {
      throw new SourceFailure(
        this.id,
        'parse',
        `${version.packageName}@${version.version} contains no extension.vsix`,
      );
    }
    return tarball.vsix;
  }

  #key(version: ExtensionVersion): string {
    return `${this.id}:${version.packageName}@${version.version}`;
  }

  /** Full tarball read, cached, for readme and changelog. */
  async #content(version: ExtensionVersion): Promise<CachedContent> {
    const key = this.#key(version);
    const cached = await this.deps.cache.getJson<CachedContent>(`content:${key}`);
    if (cached) return cached;

    const http = await this.#http();
    const bytes = await getBytes(version.locator, http, {});
    const tarball = readPvmpTarball(bytes, version.locator);

    const result: CachedContent = {
      content: await extractContent(tarball, this.deps.cache, key),
    };

    await this.deps.cache.putJson(`content:${key}`, result);
    return result;
  }
}

export const npmSourceFactory: SourceFactory = {
  type: NPM_SOURCE_TYPE,

  create(config: RawSourceConfig, deps: SourceDeps): SourceProvider {
    const id = typeof config.id === 'string' && config.id ? config.id : NPM_SOURCE_TYPE;

    if (typeof config.registry !== 'string' || config.registry.length === 0) {
      throw new SourceFailure(id, 'config', 'npm source requires a "registry" URL');
    }

    const named = typeof config.adapter === 'string' ? CATALOG_ADAPTERS[config.adapter] : undefined;
    if (typeof config.adapter === 'string' && !named) {
      throw new SourceFailure(
        id,
        'config',
        `unknown adapter "${config.adapter}"; expected one of ${Object.keys(CATALOG_ADAPTERS).join(', ')}`,
      );
    }

    const adapter = named ?? detectAdapter(config.registry);
    if (!adapter) {
      throw new SourceFailure(
        id,
        'config',
        `could not infer a catalog adapter from "${String(config.registry)}"; set "adapter" to one of ${Object.keys(CATALOG_ADAPTERS).join(', ')}`,
      );
    }

    return new NpmSource(
      {
        id,
        registry: deps.resolvePath(config.registry),
        adapter,
        scope: typeof config.scope === 'string' ? config.scope : undefined,
        repo: typeof config.repo === 'string' ? config.repo : undefined,
        baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : undefined,
      },
      deps,
    );
  },
};
