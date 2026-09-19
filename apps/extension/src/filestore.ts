import type { FileEntry, FileStat, FileStore } from '@pvmp/core';
import * as vscode from 'vscode';

/**
 * FileStore over `vscode.workspace.fs`.
 *
 * Not `node:fs`: workspace.fs resolves remote URIs transparently, so the same
 * code works in a devcontainer, over SSH and in code-server (SPEC.md §8).
 */
export function createVscodeFileStore(root: vscode.Uri): FileStore {
  const resolve = (path: string): vscode.Uri =>
    path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
      ? vscode.Uri.file(path)
      : vscode.Uri.joinPath(root, ...path.split('/').filter(Boolean));

  return {
    async read(path) {
      try {
        return await vscode.workspace.fs.readFile(resolve(path));
      } catch {
        return undefined;
      }
    },

    async write(path, data) {
      const uri = resolve(path);
      const parent = uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/')) });
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(uri, data);
    },

    async remove(path) {
      try {
        await vscode.workspace.fs.delete(resolve(path), { useTrash: false });
      } catch {
        // Already gone is the desired end state.
      }
    },

    async list(path) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(resolve(path));
        return entries.map(([name, type]): FileEntry => ({
          name,
          type: type === vscode.FileType.Directory ? 'directory' : 'file',
        }));
      } catch {
        return [];
      }
    },

    async stat(path) {
      try {
        const stat = await vscode.workspace.fs.stat(resolve(path));
        return {
          size: stat.size,
          mtime: stat.mtime,
          type: stat.type === vscode.FileType.Directory ? 'directory' : 'file',
        } satisfies FileStat;
      } catch {
        return undefined;
      }
    },
  };
}
