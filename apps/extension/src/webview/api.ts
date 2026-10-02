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
  /** Updates the badge and notifies all webviews, without re-listing. Never rejects. */
  catalogChanged: () => Promise<void>;
  /** globalStorageUri: the cache's FileStore root, and a webview resource root. */
  storage: vscode.Uri;
}

/**
 * The HostApi implementation. Each webview gets its own, because
 * `webview.asWebviewUri` mints icon URIs for that webview's origin.
 *
 * An object literal, because serveIpc exposes only own properties.
 */
export function createHostApi(deps: HostApiDeps, webview: vscode.Webview): HostApi {
  return {
    listCatalog: (): Promise<CatalogSnapshot> => deps.catalog.snapshot(),

    getDetails: (extensionId: string, version?: string): Promise<ExtensionDetails> =>
      deps.catalog.details(extensionId, version),

    async getIcon(extensionId: string, version: string): Promise<string | undefined> {
      // The webview loads icons by URI (SPEC.md §6). The copy lives in the
      // BlobCache, so the size cap and eviction apply to it.
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
      void deps.catalogChanged();
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
      void deps.catalogChanged();
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
      await deps.catalogChanged();
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
      // Drops the message when the webview is hidden. It refetches when shown.
      // Webview.postMessage, not window.postMessage: it has no target origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void webview.postMessage(message);
    },
    subscribe(handler) {
      const subscription = webview.onDidReceiveMessage((message: unknown) => handler(message));
      return () => subscription.dispose();
    },
  };
}
