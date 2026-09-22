import type { ExtensionVersion } from '@pvmp/contract';
import type {
  ExtensionDetailContent,
  FileStore,
  RawSourceConfig,
  SourceDeps,
  SourceFactory,
  SourceProvider,
} from '@pvmp/core';
import {
  extractContent,
  nonEmptyString,
  readPvmpTarball,
  readVsix,
  SourceFailure,
  toExtensionVersion,
} from '@pvmp/core';

export const LOCAL_SOURCE_TYPE = 'local';

const DEFAULT_DEPTH = 3;
/** Never worth descending into, and pathological on a big tree. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.svn', '.hg', '.cache']);

interface CachedEntry {
  version: ExtensionVersion;
  content: ExtensionDetailContent;
}

/**
 * A directory of `.tgz` packages in the pvmp format.
 *
 * Same reader as the npm source; only the transport differs (SPEC.md §4.1).
 */
export class LocalSource implements SourceProvider {
  #dispose: (() => void) | undefined;

  constructor(
    readonly id: string,
    private readonly root: string,
    private readonly depth: number,
    private readonly deps: SourceDeps,
  ) {}

  /** Starts watching the root, re-listing on change. */
  watch(onChange: () => void): void {
    this.#dispose ??= this.deps.watch?.(this.root, onChange);
  }

  dispose(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }

  async list(): Promise<ExtensionVersion[]> {
    const paths = await collectTarballs(this.deps.files, this.root, this.depth);
    this.deps.log.debug(`[${this.id}] scanned ${this.root}: ${paths.length} package(s)`);

    const results = await Promise.all(paths.map((path) => this.#read(path).catch(() => undefined)));
    return results
      .filter((entry): entry is CachedEntry => entry !== undefined)
      .map((e) => e.version);
  }

  async fetchDetails(version: ExtensionVersion): Promise<ExtensionDetailContent> {
    return (await this.#read(version.locator)).content;
  }

  async fetchIcon(version: ExtensionVersion): Promise<Uint8Array | undefined> {
    const key = await this.#key(version.locator);
    const cached = await this.deps.cache.get('icon', key);
    if (cached) return cached;

    // Not reached through #read: meta and icon blobs are evicted
    // independently, so a surviving meta entry would short-circuit #read and
    // leave an evicted icon gone for good. Re-extract instead.
    const bytes = await this.deps.files.read(version.locator);
    if (!bytes) return undefined;
    const { icon } = readPvmpTarball(bytes, version.locator);
    if (icon) await this.deps.cache.put('icon', key, icon);
    return icon;
  }

  async fetchVsix(version: ExtensionVersion): Promise<Uint8Array> {
    const bytes = await this.deps.files.read(version.locator);
    if (!bytes) {
      throw new SourceFailure(this.id, 'unreachable', `${version.locator} no longer exists`);
    }
    return readVsix(bytes, version.locator);
  }

  /**
   * Cache key: identity of the file on disk, so an edit invalidates it.
   *
   * ponytail: path+mtime+size, the same heuristic rsync and bundlers use.
   * It misses a replacement made within the same millisecond that is also
   * byte-identical in length. Hash the contents instead if that ever matters,
   * at the cost of reading every package on every scan.
   */
  async #key(path: string): Promise<string> {
    const stat = await this.deps.files.stat(path);
    if (!stat) throw new SourceFailure(this.id, 'unreachable', `${path} no longer exists`);
    return `${this.id}:${path}:${stat.mtime}:${stat.size}`;
  }

  async #read(path: string): Promise<CachedEntry> {
    const key = await this.#key(path);
    const cached = await this.deps.cache.getJson<CachedEntry>(key);
    if (cached) return cached;

    const bytes = await this.deps.files.read(path);
    if (!bytes) throw new SourceFailure(this.id, 'unreachable', `${path} could not be read`);

    const tarball = readPvmpTarball(bytes, path);
    const stat = await this.deps.files.stat(path);
    const version = toExtensionVersion(tarball.packageJson, {
      sourceId: this.id,
      locator: path,
      ...(stat ? { publishedAt: new Date(stat.mtime).toISOString() } : {}),
    });

    const entry: CachedEntry = {
      version,
      content: await extractContent(tarball, this.deps.cache, key),
    };

    await this.deps.cache.putJson(key, entry);
    return entry;
  }
}

/** Breadth-first so a shallow hit is not blocked by a deep branch. */
async function collectTarballs(files: FileStore, root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  let frontier = [root];

  for (let level = 0; level < depth && frontier.length > 0; level++) {
    // Each BFS level must resolve before the next is known; within a level the
    // listings already run in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const listings = await Promise.all(frontier.map((dir) => files.list(dir)));
    const next: string[] = [];

    for (const [index, entries] of listings.entries()) {
      const dir = frontier[index];
      if (dir === undefined) continue;
      for (const entry of entries) {
        const path = `${dir}/${entry.name}`;
        if (entry.type === 'directory') {
          if (!SKIP_DIRECTORIES.has(entry.name)) next.push(path);
        } else if (entry.name.toLowerCase().endsWith('.tgz')) {
          found.push(path);
        }
      }
    }
    frontier = next;
  }

  return found;
}

export const localSourceFactory: SourceFactory = {
  type: LOCAL_SOURCE_TYPE,
  create(config: RawSourceConfig, deps: SourceDeps): SourceProvider {
    const id = nonEmptyString(config.id) ?? LOCAL_SOURCE_TYPE;
    const path = nonEmptyString(config.path);
    if (!path) throw new SourceFailure(id, 'config', 'local source requires a "path"');
    const depth =
      typeof config.depth === 'number' && Number.isInteger(config.depth) && config.depth > 0
        ? config.depth
        : DEFAULT_DEPTH;

    return new LocalSource(id, deps.resolvePath(path), depth, deps);
  },
};
