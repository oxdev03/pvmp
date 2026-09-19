import type {
  CatalogSnapshot,
  ExtensionDetails,
  HostApi,
  InstallResult,
  Transport,
} from '@pvmp/contract';
import { encodeCacheKey } from '@pvmp/core';
import * as vscode from 'vscode';

import type { CatalogService } from '../catalog.ts';
import { addLocalSource } from '../config.ts';
import type { Installer } from '../install.ts';
import { offerReload } from '../install.ts';
import type { TokenStore } from '../secrets.ts';
import type { ExtensionState } from '../state.ts';

export interface HostApiDeps {
  catalog: CatalogService;
  installer: Installer;
  state: ExtensionState;
  tokens: TokenStore;
  log: vscode.LogOutputChannel;
  /** Opens the details panel for an extension. */
  openDetails: (extensionId: string) => void;
  /** Re-reads every source and notifies all webviews. */
  refresh: () => Promise<void>;
  /** globalStorageUri; icons are published under it for the webview to load. */
  storage: vscode.Uri;
}

/**
 * The HostApi implementation, one per webview.
 *
 * Per-webview because icon URIs are minted with `webview.asWebviewUri`, which
 * is specific to that webview's origin.
 *
 * A plain object literal, not a class instance: serveIpc dispatches against
 * the object's own function properties, so inherited members stay unreachable
 * from the webview.
 */
export function createHostApi(deps: HostApiDeps, webview: vscode.Webview): HostApi {
  return {
    listCatalog: (): Promise<CatalogSnapshot> => deps.catalog.snapshot(),

    getDetails: (extensionId: string, version?: string): Promise<ExtensionDetails> =>
      deps.catalog.details(extensionId, version),

    async getIcon(extensionId: string, version: string): Promise<string | undefined> {
      // Published as a file the webview loads by URI, rather than sent over
      // the bridge as base64 the way v1 inlined icons (SPEC.md §6).
      const target = vscode.Uri.joinPath(
        deps.storage,
        'icons',
        `${encodeCacheKey(`${extensionId}@${version}`)}.png`,
      );

      if (!(await exists(target))) {
        const bytes = await deps.catalog.icon(extensionId, version);
        if (!bytes) return undefined;
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(deps.storage, 'icons'));
        await vscode.workspace.fs.writeFile(target, bytes);
      }

      return webview.asWebviewUri(target).toString();
    },

    async install(extensionId: string, version: string): Promise<InstallResult> {
      const result = await deps.installer.install(extensionId, version);
      deps.catalog.invalidate();
      if (result.ok && result.reloadRequired) {
        void offerReload(`${extensionId} was updated. Reload to finish applying it.`);
      }
      if (!result.ok && result.error) {
        void vscode.window.showErrorMessage(`pvmp: ${result.error}`);
      }
      return result;
    },

    async uninstall(extensionId: string): Promise<InstallResult> {
      const result = await deps.installer.uninstall(extensionId);
      deps.catalog.invalidate();
      if (result.ok) {
        void offerReload(`${extensionId} was uninstalled. Reload to finish removing it.`);
      }
      return result;
    },

    refresh: () => deps.refresh(),

    async signIn(sourceId: string): Promise<void> {
      if (await deps.tokens.prompt(sourceId)) await deps.refresh();
    },

    async setPreReleaseOptIn(extensionId: string, on: boolean): Promise<void> {
      await deps.state.setPreReleaseOptIn(extensionId, on);
      deps.catalog.invalidate();
    },

    openExtension: (extensionId: string): Promise<void> => {
      deps.openDetails(extensionId);
      return Promise.resolve();
    },

    openLog: (): Promise<void> => {
      deps.log.show(true);
      return Promise.resolve();
    },

    async addLocalSource(): Promise<void> {
      if (await addLocalSource()) await deps.refresh();
    },
  };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Transport over a VS Code webview's message channel. */
export function createWebviewTransport(webview: vscode.Webview): Transport {
  return {
    post: (message) => {
      // Returns false when the webview is hidden; the view refetches on
      // becoming visible, so a dropped message is not worth queueing for.
      // Not window.postMessage: Webview.postMessage takes a single argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void webview.postMessage(message);
    },
    subscribe(handler) {
      const subscription = webview.onDidReceiveMessage((message: unknown) => handler(message));
      return () => subscription.dispose();
    },
  };
}
