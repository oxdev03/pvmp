import type { ExtensionLinks, ExtensionVersion } from '@pvmp/contract';

import type { BlobCache } from './cache.ts';
import type { FileStore } from './filestore.ts';
import { toExtensionLinks } from './manifest.ts';
import type { PvmpTarball } from './tarball.ts';

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
}

/** Everything a source may use. Supplied by the host, faked in tests. */
export interface SourceDeps {
  log: Logger;
  cache: BlobCache;
  files: FileStore;
  /** Bearer token for this source, from SecretStorage. */
  getToken(sourceId: string): Promise<string | undefined>;
  /** Expands ${userHome}, ${workspaceFolder} and ${env:NAME} in configured paths. */
  resolvePath(input: string): string;
  /**
   * Watches a directory subtree, calling back on any change. Returns a
   * disposer. Provided by the host (FileSystemWatcher); absent in tests.
   */
  watch?(root: string, onChange: () => void): () => void;
}

export interface ExtensionDetailContent {
  readme?: string;
  changelog?: string;
  links: ExtensionLinks;
}

/**
 * One configured place extensions come from.
 *
 * Each implementation lives in its own package, so the module graph enforces
 * this boundary (SPEC.md §3.2).
 */
export interface SourceProvider {
  readonly id: string;
  /** Every version of every extension this source offers. */
  list(): Promise<ExtensionVersion[]>;
  fetchDetails(version: ExtensionVersion): Promise<ExtensionDetailContent>;
  fetchIcon(version: ExtensionVersion): Promise<Uint8Array | undefined>;
  /** The raw .vsix bytes, ready to hand to VS Code. */
  fetchVsix(version: ExtensionVersion): Promise<Uint8Array>;
  /** Called when the source is removed or the extension deactivates. */
  dispose?(): void;
}

/** Turns a parsed tarball into detail content, caching its icon on the way. */
export async function extractContent(
  tarball: PvmpTarball,
  cache: BlobCache,
  iconKey: string,
): Promise<ExtensionDetailContent> {
  if (tarball.icon) await cache.put('icon', iconKey, tarball.icon);
  return {
    ...(tarball.readme ? { readme: tarball.readme } : {}),
    ...(tarball.changelog ? { changelog: tarball.changelog } : {}),
    links: toExtensionLinks(tarball.packageJson),
  };
}

/** Raw, unvalidated entry from the `pvmp.sources` setting. */
export interface RawSourceConfig {
  type?: unknown;
  id?: unknown;
  [key: string]: unknown;
}

export interface SourceFactory {
  readonly type: string;
  /** Throws SourceFailure('config') when the entry is not usable. */
  create(config: RawSourceConfig, deps: SourceDeps): SourceProvider;
}

/** Maps `type` in settings to a factory. Only activation registers factories. */
export class SourceFactoryRegistry {
  readonly #factories = new Map<string, SourceFactory>();

  register(factory: SourceFactory): this {
    this.#factories.set(factory.type, factory);
    return this;
  }

  get(type: string): SourceFactory | undefined {
    return this.#factories.get(type);
  }

  get types(): string[] {
    return [...this.#factories.keys()];
  }
}

/**
 * Derives a stable source id when the config omits one.
 *
 * Ids key SecretStorage entries, so a configured `id` is the only one that
 * survives reordering. The fallback uses the position in the list.
 */
export function defaultSourceId(config: RawSourceConfig, index: number): string {
  if (typeof config.id === 'string' && config.id.length > 0) return config.id;
  const type = typeof config.type === 'string' ? config.type : 'source';
  return `${type}-${index}`;
}
