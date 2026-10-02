import type { InstallProgress, InstallResult } from '@pvmp/contract';
import type { Logger } from '@pvmp/core';
import { errorMessage } from '@pvmp/core';
import * as vscode from 'vscode';

import type { CatalogService } from './catalog.ts';
import type { ExtensionState } from './state.ts';

const VS_INSTALL = 'workbench.extensions.installExtension';
const VS_UNINSTALL = 'workbench.extensions.uninstallExtension';

export interface InstallerDeps {
  catalog: CatalogService;
  state: ExtensionState;
  log: Logger;
  storage: vscode.Uri;
  onProgress: (progress: InstallProgress) => void;
}

function isInstalled(extensionId: string): boolean {
  return vscode.extensions.getExtension(extensionId) !== undefined;
}

export interface UpdateAllResult {
  updated: number;
  failed: number;
  /** Still backing off after an earlier failure. */
  skipped: number;
  reloadRequired: boolean;
}

export class Installer {
  readonly #installing = new Map<string, Promise<InstallResult>>();
  #updating: Promise<UpdateAllResult> | undefined;

  constructor(private readonly deps: InstallerDeps) {}

  /**
   * Joins an install of the same extension that is already running. VS Code
   * fails one of two concurrent installs, which would report an error and
   * start a backoff for a version that did install. The UI shows progress
   * instead of buttons while one runs, so a joined call asks for the same
   * version in practice.
   */
  install(extensionId: string, version: string): Promise<InstallResult> {
    const running = this.#installing.get(extensionId);
    if (running) return running;
    const started = this.#install(extensionId, version).finally(() =>
      this.#installing.delete(extensionId),
    );
    this.#installing.set(extensionId, started);
    return started;
  }

  async #install(extensionId: string, version: string): Promise<InstallResult> {
    const report = (phase: InstallProgress['phase'], message?: string) =>
      this.deps.onProgress({
        extensionId,
        version,
        phase,
        ...(message === undefined ? {} : { message }),
      });

    // VS Code needs a reload to replace a loaded extension. A first install
    // usually does not.
    const wasInstalled = isInstalled(extensionId);
    let temporary: vscode.Uri | undefined;

    try {
      report('downloading');
      const { source, version: resolved } = await this.deps.catalog.locate(extensionId, version);
      const vsix = await source.fetchVsix(resolved);

      report('extracting');
      temporary = vscode.Uri.joinPath(
        this.deps.storage,
        'tmp',
        `${extensionId}-${version}-${Date.now()}.vsix`,
      );
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.deps.storage, 'tmp'));
      await vscode.workspace.fs.writeFile(temporary, vsix);

      report('installing');
      await vscode.commands.executeCommand(VS_INSTALL, temporary);

      await this.deps.state.clearFailure(extensionId, version);
      this.deps.log.info(`installed ${extensionId}@${version}`);
      report('done');

      return { ok: true, reloadRequired: wasInstalled };
    } catch (error) {
      const message = errorMessage(error);
      this.deps.log.error(`failed to install ${extensionId}@${version}: ${message}`);
      await this.deps.state.recordFailure(extensionId, version);
      report('failed', message);
      return { ok: false, reloadRequired: false, error: message };
    } finally {
      if (temporary) {
        // A leftover temp file is harmless, and on Windows the installer may
        // still hold it open.
        await vscode.workspace.fs.delete(temporary, { useTrash: false }).then(undefined, () => {});
      }
    }
  }

  async uninstall(extensionId: string): Promise<InstallResult> {
    try {
      await vscode.commands.executeCommand(VS_UNINSTALL, extensionId);
      this.deps.log.info(`uninstalled ${extensionId}`);
      return { ok: true, reloadRequired: true };
    } catch (error) {
      const message = errorMessage(error);
      this.deps.log.error(`failed to uninstall ${extensionId}: ${message}`);
      return { ok: false, reloadRequired: false, error: message };
    }
  }

  /** Joins a run already in progress: a double click, or the background check. */
  updateAll(): Promise<UpdateAllResult> {
    this.#updating ??= this.#updateAll().finally(() => {
      this.#updating = undefined;
    });
    return this.#updating;
  }

  /**
   * Installs every available update, skipping any still in backoff. The
   * caller offers one reload at the end (SPEC.md §9).
   */
  async #updateAll(): Promise<UpdateAllResult> {
    const snapshot = await this.deps.catalog.snapshot();
    const outdated = snapshot.entries.filter((entry) => entry.status === 'update-available');

    let updated = 0;
    let failed = 0;
    let skipped = 0;
    let reloadRequired = false;

    for (const entry of outdated) {
      const target = entry.latest;
      if (!target) continue;

      if (this.deps.state.isBackingOff(entry.extensionId, target.version)) {
        this.deps.log.warn(`skipping ${entry.extensionId}@${target.version}: backing off`);
        skipped++;
        continue;
      }

      // One at a time: VS Code serialises installs anyway, and a failure is
      // easier to attribute.
      // oxlint-disable-next-line no-await-in-loop
      const result = await this.install(entry.extensionId, target.version);
      if (result.ok) {
        updated++;
        reloadRequired ||= result.reloadRequired;
      } else {
        failed++;
      }
    }

    return { updated, failed, skipped, reloadRequired };
  }
}

/** Offers a reload rather than forcing one. */
export async function offerReload(reason: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(reason, 'Reload Window', 'Later');
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}
