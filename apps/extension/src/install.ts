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

export class Installer {
  constructor(private readonly deps: InstallerDeps) {}

  async install(extensionId: string, version: string): Promise<InstallResult> {
    const report = (phase: InstallProgress['phase'], message?: string) =>
      this.deps.onProgress({
        extensionId,
        version,
        phase,
        ...(message === undefined ? {} : { message }),
      });

    // An update replaces a loaded extension, which is what makes VS Code ask
    // for a reload; a first install usually does not.
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
        // Best effort: a leftover temp file is harmless, and on Windows the
        // installer may still hold the handle briefly.
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

  /**
   * Installs every available update, skipping anything still in backoff.
   *
   * Prompts once at the end rather than reloading outright: v1 reloaded the
   * window after every single install (SPEC.md §9).
   */
  async updateAll(): Promise<{ updated: number; failed: number; reloadRequired: boolean }> {
    const snapshot = await this.deps.catalog.snapshot();
    const outdated = snapshot.entries.filter((entry) => entry.status === 'update-available');

    let updated = 0;
    let failed = 0;
    let reloadRequired = false;

    for (const entry of outdated) {
      const target = entry.latest;
      if (!target) continue;

      if (this.deps.state.isBackingOff(entry.extensionId, target.version)) {
        this.deps.log.warn(`skipping ${entry.extensionId}@${target.version}: backing off`);
        continue;
      }

      // Sequential on purpose: VS Code's install command serialises anyway,
      // and concurrent installs make failures much harder to attribute.
      // oxlint-disable-next-line no-await-in-loop
      const result = await this.install(entry.extensionId, target.version);
      if (result.ok) {
        updated++;
        reloadRequired ||= result.reloadRequired;
      } else {
        failed++;
      }
    }

    return { updated, failed, reloadRequired };
  }
}

/** Offers a reload rather than forcing one. */
export async function offerReload(reason: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(reason, 'Reload Window', 'Later');
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}
