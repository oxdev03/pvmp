import type { SourceDeps } from '@pvmp/core';
import { BlobCache, SourceFactoryRegistry } from '@pvmp/core';
import { localSourceFactory } from '@pvmp/source-local';
import { npmSourceFactory } from '@pvmp/source-npm';
import * as vscode from 'vscode';

import { CatalogService } from './catalog.ts';
import { addLocalSource, createPathResolver, readSettings, SECTION } from './config.ts';
import { createVscodeFileStore } from './filestore.ts';
import { Installer, offerReload } from './install.ts';
import { createLogger } from './log.ts';
import { TokenStore } from './secrets.ts';
import { ExtensionState } from './state.ts';
import type { HostApiDeps } from './webview/api.ts';
import {
  DetailsPanel,
  MarketplaceViewProvider,
  SIDEBAR_VIEW_ID,
  WebviewHub,
} from './webview/views.ts';

export const COMMANDS = {
  refresh: 'pvmp.refresh',
  updateAll: 'pvmp.updateAll',
  addSource: 'pvmp.addSource',
  signIn: 'pvmp.signIn',
  openSettings: 'pvmp.openSettings',
  showLog: 'pvmp.showLog',
} as const;

/**
 * Held for deactivate(): the cache index must be written before the window
 * closes, or blobs added this session are invisible to the next one's prune
 * and never get evicted.
 */
let activeCache: BlobCache | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Private Marketplace', { log: true });
  const log = createLogger(channel);
  context.subscriptions.push(channel);

  const storage = context.globalStorageUri;
  const files = createVscodeFileStore(storage);
  const state = new ExtensionState(context.globalState);
  const tokens = new TokenStore(context.secrets);
  const hub = new WebviewHub();
  context.subscriptions.push(new vscode.Disposable(() => hub.dispose()));

  const settings = readSettings();
  const cache = new BlobCache(files, 'cache', settings.cacheSizeMb * 1024 * 1024);
  activeCache = cache;

  const sourceDeps: SourceDeps = {
    log,
    cache,
    files,
    getToken: (sourceId) => Promise.resolve(tokens.get(sourceId)),
    resolvePath: createPathResolver(log),
    watch: (root, onChange) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(root), '**/*.tgz'),
      );
      watcher.onDidCreate(onChange);
      watcher.onDidChange(onChange);
      watcher.onDidDelete(onChange);
      context.subscriptions.push(watcher);
      return () => watcher.dispose();
    },
  };

  const registry = new SourceFactoryRegistry()
    .register(localSourceFactory)
    .register(npmSourceFactory);

  const catalog = new CatalogService({
    registry,
    sourceDeps,
    state,
    log,
    onSourceError: (error) => hub.emit('sourceError', error),
  });
  catalog.reloadSources();
  context.subscriptions.push(new vscode.Disposable(() => catalog.dispose()));

  const installer = new Installer({
    catalog,
    state,
    log,
    storage,
    onProgress: (progress) => hub.emit('installProgress', progress),
  });

  let sidebar: MarketplaceViewProvider | undefined;

  const refresh = async (): Promise<void> => {
    catalog.reloadSources();
    catalog.invalidate();
    await state.setLastCheck(Date.now());
    const snapshot = await catalog.snapshot();
    sidebar?.setBadge(snapshot.entries.filter((e) => e.status === 'update-available').length);
    hub.emit('catalogChanged');
    await cache.prune();
    await cache.flush();
  };

  const apiDeps: HostApiDeps = {
    catalog,
    installer,
    state,
    tokens,
    log: channel,
    storage,
    openDetails: (extensionId) =>
      DetailsPanel.show(extensionId, context.extensionUri, storage, apiDeps, hub, channel),
    refresh,
  };

  sidebar = new MarketplaceViewProvider(context.extensionUri, storage, apiDeps, hub, channel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refresh, () => refresh()),

    vscode.commands.registerCommand(COMMANDS.addSource, async () => {
      if (await addLocalSource()) await refresh();
    }),

    vscode.commands.registerCommand(COMMANDS.openSettings, () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:oxdev03.pvmp`),
    ),

    vscode.commands.registerCommand(COMMANDS.showLog, () => channel.show(true)),

    vscode.commands.registerCommand(COMMANDS.signIn, async () => {
      const ids = catalog.sources.map((source) => source.id);
      if (ids.length === 0) {
        void vscode.window.showInformationMessage('pvmp: no sources are configured.');
        return;
      }
      const picked =
        ids.length === 1 ? ids[0] : await vscode.window.showQuickPick(ids, { title: 'Sign in to' });
      if (picked && (await tokens.prompt(picked))) await refresh();
    }),

    vscode.commands.registerCommand(COMMANDS.updateAll, async () => {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Updating extensions…' },
        () => installer.updateAll(),
      );

      catalog.invalidate();
      hub.emit('catalogChanged');

      if (result.updated === 0 && result.failed === 0) {
        void vscode.window.showInformationMessage('pvmp: everything is up to date.');
      } else if (result.reloadRequired) {
        void offerReload(
          `pvmp updated ${result.updated} extension(s). Reload to finish applying them.`,
        );
      }
    }),
  );

  // Background check. Opt-in and interval-driven; it never installs unless
  // pvmp.autoUpdate is on (SPEC.md §9).
  let timer: ReturnType<typeof setInterval> | undefined;

  const restartTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;

    const { checkInterval } = readSettings();
    if (checkInterval <= 0) {
      log.info('background update check is disabled');
      return;
    }

    timer = setInterval(() => void backgroundCheck(), checkInterval * 1000);
    log.info(`background update check every ${checkInterval}s`);
  };

  const backgroundCheck = async (): Promise<void> => {
    try {
      catalog.invalidate();
      const snapshot = await catalog.snapshot();
      const outdated = snapshot.entries.filter((entry) => entry.status === 'update-available');
      sidebar?.setBadge(outdated.length);
      hub.emit('catalogChanged');
      await state.setLastCheck(Date.now());

      if (outdated.length === 0) return;
      if (!readSettings().autoUpdate) return;

      log.info(`auto-updating ${outdated.length} extension(s)`);
      const result = await installer.updateAll();
      if (result.reloadRequired) {
        void offerReload(`pvmp auto-updated ${result.updated} extension(s). Reload to apply.`);
      }
    } catch (error) {
      log.error(`background check failed: ${String(error)}`);
    }
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (timer) clearInterval(timer);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SECTION)) return;
      log.info('settings changed, reloading sources');
      restartTimer();
      void refresh();
    }),
    vscode.extensions.onDidChange(() => {
      catalog.invalidate();
      hub.emit('catalogChanged');
    }),
  );

  restartTimer();
  void refresh();
}

export async function deactivate(): Promise<void> {
  DetailsPanel.disposeCurrent();
  try {
    await activeCache?.flush();
  } catch {
    // Nothing useful to do: the window is closing and there is nowhere left to
    // report to. A lost index costs a re-download; a rejected deactivate() is
    // an error notification the user can do nothing about.
  }
  activeCache = undefined;
}
