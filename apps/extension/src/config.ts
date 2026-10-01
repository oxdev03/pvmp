import type { RawSourceConfig } from '@pvmp/core';
import { isRecord } from '@pvmp/core';
import * as vscode from 'vscode';

export const SECTION = 'pvmp';

export interface PvmpSettings {
  sources: RawSourceConfig[];
  autoUpdate: boolean;
  /** Seconds. 0 disables the background check. */
  checkInterval: number;
  cacheSizeMb: number;
}

export function readSettings(): PvmpSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const raw = config.get<unknown[]>('sources', []);

  return {
    sources: raw.filter(isRecord),
    autoUpdate: config.get<boolean>('autoUpdate', false),
    checkInterval: config.get<number>('checkInterval', 3600),
    cacheSizeMb: config.get<number>('cacheSizeMb', 200),
  };
}

/** Appends the picked folders to pvmp.sources, which triggers a refresh. */
export async function addLocalSource(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: 'Use as marketplace source',
    title: 'Select folders containing .tgz extension packages',
  });
  if (!picked?.length) return;

  const config = vscode.workspace.getConfiguration(SECTION);
  const existing = config.get<RawSourceConfig[]>('sources', []);
  const known = new Set(
    existing.filter((s) => s['type'] === 'local').map((s) => String(s['path'])),
  );

  const added = picked
    .map((uri) => uri.fsPath)
    .filter((path) => !known.has(path))
    .map((path): RawSourceConfig => ({ type: 'local', path }));

  if (added.length === 0) return;

  await config.update('sources', [...existing, ...added], vscode.ConfigurationTarget.Global);
}

/**
 * Expands ${workspaceFolder}, ${userHome} and ${env:NAME} in a configured path.
 *
 * They resolve on the machine running the extension host, which in a remote
 * window is the remote, so the result is logged (SPEC.md §8).
 */
export function createPathResolver(log: { debug(message: string): void }) {
  return (input: string): string => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const userHome = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';

    const resolved = input
      .replaceAll('${workspaceFolder}', workspaceFolder)
      .replaceAll('${userHome}', userHome)
      .replace(/\$\{env:([^}]+)\}/g, (match, name: string) => process.env[name] ?? match);

    if (resolved !== input) log.debug(`resolved "${input}" to "${resolved}"`);
    return resolved;
  };
}
