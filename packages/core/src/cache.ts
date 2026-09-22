import type { FileStore } from './filestore.ts';

export type CacheKind = 'meta' | 'readme' | 'changelog' | 'icon';

const EXTENSION: Record<CacheKind, string> = {
  meta: 'json',
  readme: 'md',
  changelog: 'md',
  icon: 'png',
};

const encodeChar = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  return `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
};

/**
 * Makes a cache key safe to use as a single path segment.
 *
 * Keys are built from registry-supplied package names and versions, so this is
 * a trust boundary. Percent-encoding everything outside a strict allowlist
 * removes the separators; encoding a leading dot additionally rules out the
 * two segments that would still traverse on their own, `.` and `..`.
 */
export function encodeCacheKey(key: string): string {
  const encoded = key.replace(/[^A-Za-z0-9._-]/g, encodeChar);
  return encoded.startsWith('.') ? encodeChar('.') + encoded.slice(1) : encoded;
}

interface IndexEntry {
  size: number;
  /**
   * Monotonic access counter, not a timestamp. `Date.now()` has millisecond
   * resolution, so several puts in the same tick would be unorderable and LRU
   * eviction would pick arbitrarily.
   */
  seq: number;
}

const INDEX_PATH = 'index.json';

/**
 * Content-addressed blob cache with LRU eviction (SPEC.md §6).
 *
 * Callers choose the key: sha/integrity for remote packages, path+mtime+size
 * for local files. The cache itself never decides what is stale.
 */
export class BlobCache {
  #index = new Map<string, IndexEntry>();
  #seq = 0;
  #loaded = false;
  #dirty = false;

  constructor(
    private readonly store: FileStore,
    private readonly root: string,
    private readonly maxBytes = 200 * 1024 * 1024,
  ) {}

  /** Where a blob lives, relative to the FileStore root. */
  path(kind: CacheKind, key: string): string {
    return `${this.root}/${kind}/${encodeCacheKey(key)}.${EXTENSION[kind]}`;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    const raw = await this.store.read(`${this.root}/${INDEX_PATH}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<string, IndexEntry>;
      for (const [path, entry] of Object.entries(parsed)) {
        if (typeof entry?.size === 'number' && typeof entry?.seq === 'number') {
          this.#index.set(path, entry);
          this.#seq = Math.max(this.#seq, entry.seq + 1);
        }
      }
    } catch {
      // A corrupt index costs a re-download, not a failure.
      this.#index.clear();
    }
  }

  async get(kind: CacheKind, key: string): Promise<Uint8Array | undefined> {
    await this.#load();
    const path = this.path(kind, key);
    const data = await this.store.read(path);
    if (!data) {
      this.#index.delete(path);
      return undefined;
    }
    this.#index.set(path, { size: data.length, seq: this.#seq++ });
    this.#dirty = true;
    return data;
  }

  async put(kind: CacheKind, key: string, data: Uint8Array): Promise<void> {
    await this.#load();
    const path = this.path(kind, key);
    await this.store.write(path, data);
    this.#index.set(path, { size: data.length, seq: this.#seq++ });
    this.#dirty = true;
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    const data = await this.get('meta', key);
    if (!data) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch {
      return undefined;
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.put('meta', key, new TextEncoder().encode(JSON.stringify(value)));
  }

  async getText(kind: CacheKind, key: string): Promise<string | undefined> {
    const data = await this.get(kind, key);
    return data ? new TextDecoder().decode(data) : undefined;
  }

  async putText(kind: CacheKind, key: string, text: string): Promise<void> {
    await this.put(kind, key, new TextEncoder().encode(text));
  }

  get totalBytes(): number {
    let total = 0;
    for (const entry of this.#index.values()) total += entry.size;
    return total;
  }

  /**
   * Reconciles the index with what is actually on disk.
   *
   * The index is an optimisation, not the source of truth. It is only
   * persisted by flush(), so a session that ends without one leaves blobs the
   * next run cannot see — and an unseen blob is never evicted, which made the
   * cache grow without bound. Anything on disk but unindexed is adopted as
   * least-recently-used; anything indexed but gone is dropped.
   */
  async #reconcile(): Promise<void> {
    await this.#load();

    // Snapshotted before the listing: anything added to the index while the
    // listing is in flight (refresh() emits catalogChanged, so the webview's
    // getIcon puts race prune by construction) is newer than what we are
    // looking at and must not be treated as missing from disk.
    const known = new Set(this.#index.keys());

    const kinds = Object.keys(EXTENSION) as CacheKind[];
    const listings = await Promise.all(
      kinds.map((kind) => this.store.list(`${this.root}/${kind}`)),
    );

    const onDisk: string[] = [];
    for (const [index, entries] of listings.entries()) {
      const kind = kinds[index];
      for (const entry of entries) {
        if (entry.type === 'file') onDisk.push(`${this.root}/${kind}/${entry.name}`);
      }
    }

    const unknown = onDisk.filter((path) => !this.#index.has(path));
    const sizes = await Promise.all(unknown.map((path) => this.store.stat(path)));
    for (const [index, path] of unknown.entries()) {
      // seq 0 so an orphan is evicted before anything this session touched.
      this.#index.set(path, { size: sizes[index]?.size ?? 0, seq: 0 });
      this.#dirty = true;
    }

    const seen = new Set(onDisk);
    for (const path of known) {
      if (seen.has(path)) continue;
      this.#index.delete(path);
      this.#dirty = true;
    }
  }

  /** Evicts least-recently-used blobs until the cache fits under maxBytes. */
  async prune(): Promise<void> {
    await this.#reconcile();
    let total = this.totalBytes;
    if (total <= this.maxBytes) return;

    const byAge = [...this.#index.entries()].toSorted((a, b) => a[1].seq - b[1].seq);
    const victims: string[] = [];
    for (const [path, entry] of byAge) {
      if (total <= this.maxBytes) break;
      victims.push(path);
      this.#index.delete(path);
      total -= entry.size;
    }
    if (victims.length === 0) return;
    this.#dirty = true;
    await Promise.all(victims.map((path) => this.store.remove(path)));
  }

  async flush(): Promise<void> {
    if (!this.#dirty) return;
    // Cleared up front so a put during the write is not swallowed, and put
    // back on failure so the index stays retryable rather than silently lost.
    this.#dirty = false;
    const payload = Object.fromEntries(this.#index);
    try {
      await this.store.write(
        `${this.root}/${INDEX_PATH}`,
        new TextEncoder().encode(JSON.stringify(payload)),
      );
    } catch (error) {
      this.#dirty = true;
      throw error;
    }
  }
}
