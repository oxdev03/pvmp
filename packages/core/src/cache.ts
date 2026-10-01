import type { FileStore } from './filestore.ts';

export type CacheKind = 'meta' | 'icon';

const EXTENSION: Record<CacheKind, string> = {
  meta: 'json',
  icon: 'png',
};

const encodeChar = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  return `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
};

/**
 * Makes a cache key safe to use as a single path segment.
 *
 * Keys contain registry-supplied names and versions, so this is a trust
 * boundary. Percent-encoding everything outside the allowlist removes path
 * separators, and encoding a leading dot rules out `.` and `..`.
 */
export function encodeCacheKey(key: string): string {
  const encoded = key.replace(/[^A-Za-z0-9._-]/g, encodeChar);
  return encoded.startsWith('.') ? encodeChar('.') + encoded.slice(1) : encoded;
}

interface IndexEntry {
  size: number;
  /** Access order for LRU. A counter, because Date.now() ties within a millisecond. */
  seq: number;
}

const INDEX_PATH = 'index.json';

/**
 * Blob cache with LRU eviction (SPEC.md §6).
 *
 * The cache never decides what is stale. Callers build keys that change when
 * the content does: source, name and version for npm; path, mtime and size
 * for local files.
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

  get totalBytes(): number {
    let total = 0;
    for (const entry of this.#index.values()) total += entry.size;
    return total;
  }

  /**
   * Brings the index in line with the disk.
   *
   * Only flush() persists the index, so a session that ends without one
   * leaves blobs the next session cannot see, and prune would never evict
   * them. Unindexed files are adopted as least recently used; index entries
   * whose file is gone are dropped.
   */
  async #reconcile(): Promise<void> {
    await this.#load();

    // Taken before listing. refresh() emits catalogChanged just before it
    // prunes, so webview icon puts land while the listing runs; a path
    // indexed after this point is new, and its absence from the listing
    // proves nothing.
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
    // Cleared first so a put during the write marks it dirty again, and
    // restored on failure so the next flush retries.
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
