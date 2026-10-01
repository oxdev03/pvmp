/**
 * The only filesystem surface core depends on.
 *
 * The extension host implements it with `vscode.workspace.fs`, which works
 * over SSH, in devcontainers and in code-server. Tests use the in-memory one
 * below, so core tests need no VS Code.
 */
export interface FileStore {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /** Names of the direct children of `path`; empty when it does not exist. */
  list(path: string): Promise<FileEntry[]>;
  stat(path: string): Promise<FileStat | undefined>;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
}

export interface FileStat {
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  type: 'file' | 'directory';
}

/**
 * In-memory FileStore for tests.
 *
 * mtime advances at least 1ms per write. With a bare Date.now(), two writes
 * in one tick would share an mtime and the local source's mtime-based cache
 * keys would collide.
 */
export function createMemoryFileStore(): FileStore {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  let clock = Date.now();
  const tick = () => (clock = Math.max(clock + 1, Date.now()));

  return {
    read: (path) => Promise.resolve(files.get(path)?.data),
    write: (path, data) => {
      files.set(path, { data, mtime: tick() });
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
    list: (path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      const entries: FileEntry[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!name || names.has(name)) continue;
        names.add(name);
        entries.push({ name, type: slash === -1 ? 'file' : 'directory' });
      }
      return Promise.resolve(entries);
    },
    stat: (path) => {
      const file = files.get(path);
      return Promise.resolve(
        file ? { size: file.data.length, mtime: file.mtime, type: 'file' as const } : undefined,
      );
    },
  };
}
