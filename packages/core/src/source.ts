import type { ExtensionLinks, ExtensionVersion } from '@pvmp/contract';

import type { BlobCache } from './cache.ts';
import type { FileStore } from './filestore.ts';

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
  /** Expands ${userHome} and ${workspaceFolder} in configured paths. */
  resolvePath(input: string): string;
}

export interface SourceCall {
  signal?: AbortSignal;
}

export interface ExtensionDetailContent {
  readme?: string;
  changelog?: string;
  links: ExtensionLinks;
}

/**
 * One configured place extensions come from.
 *
 * Implementations live in their own packages so this boundary is enforced by
 * the module graph rather than by convention (SPEC.md §3.2).
 */
export interface SourceProvider {
  readonly id: string;
  /** Every version of every extension this source offers. */
  list(call?: SourceCall): Promise<ExtensionVersion[]>;
  fetchDetails(version: ExtensionVersion, call?: SourceCall): Promise<ExtensionDetailContent>;
  fetchIcon(version: ExtensionVersion, call?: SourceCall): Promise<Uint8Array | undefined>;
  /** The raw .vsix bytes, ready to hand to VS Code. */
  fetchVsix(version: ExtensionVersion, call?: SourceCall): Promise<Uint8Array>;
  /** Called when the source is removed or the extension deactivates. */
  dispose?(): void;
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

/**
 * Maps `type` in settings to a factory. Registration is explicit at
 * activation; there is no third-party plugin API.
 */
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
 * Ids key SecretStorage entries and appear in settings ordering, so they must
 * not shift when unrelated sources are added or reordered.
 */
export function defaultSourceId(config: RawSourceConfig, index: number): string {
  if (typeof config.id === 'string' && config.id.length > 0) return config.id;
  const type = typeof config.type === 'string' ? config.type : 'source';
  return `${type}-${index}`;
}
