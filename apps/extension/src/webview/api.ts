import type {
  CatalogSnapshot,
  ExtensionDetails,
  HostApi,
  InstallResult,
  Transport,
} from '@pvmp/contract';
import type { BlobCache } from '@pvmp/core';
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
  cache: BlobCache;
  log: vscode.LogOutputChannel;
  /** Opens the details panel for an extension. */
  openDetails: (extensionId: string) => void;
  /** Re-reads every source and notifies all webviews. */
  refresh: () => Promise<void>;
  /** globalStorageUri: the cache's FileStore root, and a webview resource root. */
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
      // Served as a file the webview loads by URI, rather than sent over the
      // bridge as base64 the way v1 inlined icons (SPEC.md §6). Kept in the
      // BlobCache so it is size-capped and evicted like every other blob.
      const key = `webview:${extensionId}@${version}`;
      if (!(await deps.cache.get('icon', key))) {
        const bytes = await deps.catalog.icon(extensionId, version);
        if (!bytes) return undefined;
        await deps.cache.put('icon', key, bytes);
      }
      const path = deps.cache.path('icon', key).split('/');
      return webview.asWebviewUri(vscode.Uri.joinPath(deps.storage, ...path)).toString();
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

    addLocalSource: () => addLocalSource(),
  };
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
