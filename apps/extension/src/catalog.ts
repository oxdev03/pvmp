import type {
  CatalogEntry,
  CatalogSnapshot,
  ExtensionDetails,
  ExtensionVersion,
  SourceError,
  TargetPlatform,
} from '@pvmp/contract';
import type {
  InstalledExtension,
  Logger,
  SourceDeps,
  SourceFactoryRegistry,
  SourceProvider,
} from '@pvmp/core';
import {
  buildCatalog,
  defaultSourceId,
  detectTargetPlatform,
  errorMessage,
  SourceFailure,
} from '@pvmp/core';
import * as vscode from 'vscode';

import { readSettings } from './config.ts';
import type { ExtensionState } from './state.ts';

export interface CatalogDeps {
  registry: SourceFactoryRegistry;
  sourceDeps: SourceDeps;
  state: ExtensionState;
  log: Logger;
  onSourceError: (error: SourceError) => void;
}

async function isAlpine(): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file('/etc/alpine-release'));
    return true;
  } catch {
    return false;
  }
}

/** What VS Code currently has installed, whatever its origin (SPEC.md §9). */
function installedExtensions(): InstalledExtension[] {
  const installed: InstalledExtension[] = [];
  for (const extension of vscode.extensions.all) {
    const manifest = extension.packageJSON as { version?: unknown; isBuiltin?: unknown };
    if (manifest?.isBuiltin === true) continue;
    if (typeof manifest?.version !== 'string') continue;
    installed.push({ extensionId: extension.id, version: manifest.version });
  }
  return installed;
}

/**
 * Builds the catalog by asking every configured source and merging the result.
 *
 * A source that fails contributes no entries and one SourceError; it never
 * takes the rest of the catalog down with it.
 */
export class CatalogService {
  #sources: SourceProvider[] = [];
  #order: string[] = [];
  #errors: SourceError[] = [];
  #runtimeErrors: SourceError[] = [];
  #versions: ExtensionVersion[] | undefined;
  #loading: Promise<ExtensionVersion[]> | undefined;
  #platform: TargetPlatform | undefined;
  #generation = 0;

  constructor(private readonly deps: CatalogDeps) {}

  /** Rebuilds providers from settings. Safe to call on every config change. */
  reloadSources(): void {
    this.dispose();
    const { sources } = readSettings();
    const built: SourceProvider[] = [];
    const errors: SourceError[] = [];

    for (const [index, config] of sources.entries()) {
      const id = defaultSourceId(config, index);
      const type = typeof config.type === 'string' ? config.type : '';
      const factory = this.deps.registry.get(type);

      if (!factory) {
        errors.push({
          sourceId: id,
          kind: 'config',
          message: `Unknown source type "${type}". Expected one of: ${this.deps.registry.types.join(', ')}.`,
        });
        continue;
      }

      try {
        built.push(factory.create({ ...config, id }, this.deps.sourceDeps));
      } catch (error) {
        errors.push(toSourceError(id, error));
      }
    }

    this.#sources = built;
    this.#order = built.map((source) => source.id);
    this.#errors = errors;
    this.invalidate();
    this.deps.log.info(`configured ${built.length} source(s): ${this.#order.join(', ') || 'none'}`);
  }

  /**
   * Drops the cached catalog and abandons any load already in flight.
   *
   * A load started before a reload was built from the previous provider list,
   * which reloadSources() has since disposed. Joining it would show extensions
   * from a source the user just removed, and errors from disposed ones.
   */
  invalidate(): void {
    this.#versions = undefined;
    this.#loading = undefined;
    this.#generation++;
  }

  /**
   * Lists every source once, sharing one in-flight request.
   *
   * Without the shared promise, concurrent callers each re-list every source:
   * two webviews mounting together, or a burst of getIcon calls that each
   * resolve through locate(), would multiply the network work.
   */
  async #load(): Promise<ExtensionVersion[]> {
    if (this.#versions) return this.#versions;
    if (this.#loading) return this.#loading;

    const generation = this.#generation;
    const sources = this.#sources;
    const pending: Promise<ExtensionVersion[]> = (async () => {
      const errors: SourceError[] = [];
      const results = await Promise.all(
        sources.map(async (source) => {
          try {
            return await source.list();
          } catch (error) {
            const sourceError = toSourceError(source.id, error);
            errors.push(sourceError);
            this.deps.log.error(`[${source.id}] ${sourceError.message}`);
            this.deps.onSourceError(sourceError);
            return [];
          }
        }),
      );

      const versions = results.flat();
      // ponytail: invalidation discards the result, it does not cancel the
      // listing. The caller that started it sees this stale answer once;
      // everyone after the reload gets the reload's own load.
      if (generation === this.#generation) {
        this.#versions = versions;
        this.#runtimeErrors = errors;
      }
      return versions;
    })().finally(() => {
      if (this.#loading === pending) this.#loading = undefined;
    });

    this.#loading = pending;
    return pending;
  }

  async snapshot(): Promise<CatalogSnapshot> {
    this.#platform ??= detectTargetPlatform(process.platform, process.arch, await isAlpine());
    const versions = await this.#load();

    const entries = buildCatalog(
      versions,
      installedExtensions(),
      {
        vscodeVersion: vscode.version,
        targetPlatform: this.#platform,
        preReleaseOptIn: this.deps.state.preReleaseOptIn,
      },
      this.#order,
    );

    return {
      entries,
      errors: [...this.#errors, ...this.#runtimeErrors],
      vscodeVersion: vscode.version,
      targetPlatform: this.#platform,
    };
  }

  /** Resolves an extension id and version back to its owning source. */
  async locate(
    extensionId: string,
    version?: string,
  ): Promise<{ source: SourceProvider; version: ExtensionVersion; entry: CatalogEntry }> {
    const snapshot = await this.snapshot();
    const entry = snapshot.entries.find((candidate) => candidate.extensionId === extensionId);
    if (!entry) throw new Error(`No such extension: ${extensionId}`);

    const resolved =
      (version ? entry.versions.find((v) => v.version === version && !v.shadowed) : undefined) ??
      entry.latest ??
      entry.versions[0];
    if (!resolved) throw new Error(`${extensionId} has no installable version`);

    const source = this.#sources.find((candidate) => candidate.id === resolved.sourceId);
    if (!source) throw new Error(`Source "${resolved.sourceId}" is no longer configured`);

    return { source, version: resolved, entry };
  }

  async details(extensionId: string, version?: string): Promise<ExtensionDetails> {
    const { source, version: resolved, entry } = await this.locate(extensionId, version);
    const content = await source.fetchDetails(resolved);
    return {
      entry,
      selectedVersion: resolved.version,
      ...(content.readme === undefined ? {} : { readme: content.readme }),
      ...(content.changelog === undefined ? {} : { changelog: content.changelog }),
      links: content.links,
    };
  }

  async icon(extensionId: string, version: string): Promise<Uint8Array | undefined> {
    const { source, version: resolved } = await this.locate(extensionId, version);
    return source.fetchIcon(resolved);
  }

  get sources(): readonly SourceProvider[] {
    return this.#sources;
  }

  dispose(): void {
    for (const source of this.#sources) source.dispose?.();
    this.#sources = [];
  }
}

export function toSourceError(sourceId: string, error: unknown): SourceError {
  if (error instanceof SourceFailure) {
    return { sourceId: error.sourceId, kind: error.kind, message: error.message };
  }
  return {
    sourceId,
    kind: 'unknown',
    message: errorMessage(error),
  };
}
