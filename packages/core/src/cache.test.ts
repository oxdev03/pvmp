import { describe, expect, it } from 'vitest';

import { BlobCache, encodeCacheKey } from './cache.ts';
import { createMemoryFileStore } from './filestore.ts';

const bytes = (n: number) => new Uint8Array(n).fill(1);

describe('encodeCacheKey', () => {
  it('keeps safe characters as-is', () => {
    expect(encodeCacheKey('vsc-lint_1.4.0')).toBe('vsc-lint_1.4.0');
  });

  // The property that matters: the result is one path segment that cannot
  // traverse. Percent-encoded dots inside it are harmless.
  it.each([
    '@corp/vsc-lint@1.4.0',
    '../../etc/passwd',
    '..\\..\\windows',
    'a/b/../c',
    '.',
    '..',
    '/absolute/path',
  ])('encodes %s into a single non-traversing segment', (key) => {
    const encoded = encodeCacheKey(key);
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('\\');
    expect(encoded).not.toBe('.');
    expect(encoded).not.toBe('..');
  });

  it('is injective for keys that differ only by an encoded character', () => {
    expect(encodeCacheKey('a/b')).not.toBe(encodeCacheKey('a:b'));
  });
});

function make(maxBytes?: number) {
  const store = createMemoryFileStore();
  return { store, cache: new BlobCache(store, 'cache', maxBytes) };
}

describe('BlobCache', () => {
  it('round-trips a blob', async () => {
    const { cache } = make();
    await cache.put('icon', 'acme.lint@1.0.0', bytes(10));
    expect(await cache.get('icon', 'acme.lint@1.0.0')).toEqual(bytes(10));
  });

  it('returns undefined for a key it has never seen', async () => {
    const { cache } = make();
    expect(await cache.get('icon', 'nope')).toBeUndefined();
  });

  it('round-trips JSON and text', async () => {
    const { cache } = make();
    await cache.putJson('meta-key', { a: 1 });
    await cache.putText('readme', 'r', '# hi');
    expect(await cache.getJson('meta-key')).toEqual({ a: 1 });
    expect(await cache.getText('readme', 'r')).toBe('# hi');
  });

  it('survives a corrupt index rather than throwing', async () => {
    const { store, cache } = make();
    await store.write('cache/index.json', new TextEncoder().encode('{ not json'));
    await expect(cache.get('icon', 'x')).resolves.toBeUndefined();
  });

  it('writes an index that a later instance can read', async () => {
    const { store, cache } = make();
    await cache.put('icon', 'a', bytes(5));
    await cache.flush();

    const reopened = new BlobCache(store, 'cache');
    expect(await reopened.get('icon', 'a')).toEqual(bytes(5));
  });

  it('forgets an entry whose file disappeared underneath it', async () => {
    const { store, cache } = make();
    await cache.put('icon', 'a', bytes(5));
    await store.remove('cache/icon/a.png');
    expect(await cache.get('icon', 'a')).toBeUndefined();
    expect(cache.totalBytes).toBe(0);
  });

  describe('prune', () => {
    it('does nothing while under the size cap', async () => {
      const { cache } = make(1000);
      await cache.put('icon', 'a', bytes(100));
      await cache.prune();
      expect(await cache.get('icon', 'a')).toBeDefined();
    });

    it('evicts blobs a previous session never wrote to the index', async () => {
      // The index is only persisted by flush(). A session that ends without
      // one leaves blobs on disk that the next run cannot see — and an unseen
      // blob was never evicted, so the cache grew without bound.
      const store = createMemoryFileStore();
      const first = new BlobCache(store, 'cache', 250);
      await first.put('icon', 'a', bytes(200));
      await first.put('icon', 'b', bytes(200));
      // Deliberately no flush(): simulate the window closing.

      const second = new BlobCache(store, 'cache', 250);
      await second.prune();

      expect(second.totalBytes).toBeLessThanOrEqual(250);
      const survivors = await store.list('cache/icon');
      expect(survivors).toHaveLength(1);
    });

    it('forgets index entries whose files are gone', async () => {
      const { store, cache } = make(1000);
      await cache.put('icon', 'a', bytes(100));
      await cache.put('icon', 'b', bytes(100));
      expect(cache.totalBytes).toBe(200);

      await store.remove('cache/icon/a.png');
      await cache.prune();

      expect(cache.totalBytes).toBe(100);
    });

    it('evicts least-recently-used blobs until it fits', async () => {
      const { cache } = make(250);
      await cache.put('icon', 'oldest', bytes(100));
      await cache.put('icon', 'middle', bytes(100));
      await cache.put('icon', 'newest', bytes(100));

      // Touch the oldest so it is no longer the least recently used.
      await cache.get('icon', 'oldest');
      await cache.prune();

      expect(await cache.get('icon', 'middle')).toBeUndefined();
      expect(await cache.get('icon', 'oldest')).toBeDefined();
      expect(await cache.get('icon', 'newest')).toBeDefined();
      expect(cache.totalBytes).toBeLessThanOrEqual(250);
    });
  });
});
