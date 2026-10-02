import type { CatalogSnapshot } from '@pvmp/contract';
import type { Logger, SourceDeps } from '@pvmp/core';
import { BlobCache, SourceFactoryRegistry } from '@pvmp/core';
import { localSourceFactory } from '@pvmp/source-local';
import { npmSourceFactory } from '@pvmp/source-npm';
import * as vscode from 'vscode';

import { CatalogService } from './catalog.ts';
import { addLocalSource, createPathResolver, readSettings, SECTION } from './config.ts';
import { createVscodeFileStore } from './filestore.ts';
import { Installer, offerReload } from './install.ts';
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

const MB = 1024 * 1024;
/** setInterval's 32-bit limit, in milliseconds. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** For deactivate(), which must flush the cache index before the window closes. */
let activeCache: BlobCache | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // A LogOutputChannel satisfies Logger, and you can change its level from
  // the Output panel without reloading (SPEC.md §7.4).
  const channel = vscode.window.createOutputChannel('Private Marketplace', { log: true });
  const log: Logger = channel;
  context.subscriptions.push(channel);

  const storage = context.globalStorageUri;
  const files = createVscodeFileStore(storage);
  const state = new ExtensionState(context.globalState);
  const tokens = new TokenStore(context.secrets);
  const hub = new WebviewHub();
  context.subscriptions.push(new vscode.Disposable(() => hub.dispose()));

  const cache = new BlobCache(files, 'cache', readSettings().cacheSizeMb * MB);
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
  });
  context.subscriptions.push(new vscode.Disposable(() => catalog.dispose()));

  const installer = new Installer({
    catalog,
    state,
    log,
    storage,
    onProgress: (progress) => hub.emit('installProgress', progress),
  });

  let sidebar: MarketplaceViewProvider | undefined;

  /**
   * Updates the badge and every open webview. Installs and the pre-release
   * opt-in change entry status without changing any source listing, so this
   * does not re-list.
   */
  const notify = async (): Promise<CatalogSnapshot> => {
    const snapshot = await catalog.snapshot();
    sidebar?.setBadge(snapshot.entries.filter((e) => e.status === 'update-available').length);
    hub.emit('catalogChanged');
    return snapshot;
  };

  /** Re-lists every source, then notifies. */
  const republish = (): Promise<CatalogSnapshot> => {
    catalog.invalidate();
    return notify();
  };

  const refresh = async (): Promise<void> => {
    catalog.reloadSources();
    await republish();
    cache.maxBytes = readSettings().cacheSizeMb * MB;
    await cache.prune();
    await cache.flush();
  };

  const apiDeps: HostApiDeps = {
    catalog,
    installer,
    state,
    tokens,
    cache,
    log: channel,
    storage,
    openDetails: (extensionId) =>
      DetailsPanel.show(extensionId, context.extensionUri, apiDeps, hub),
    refresh,
    catalogChanged: async () => {
      try {
        await notify();
      } catch (error) {
        log.error(`catalog update failed: ${String(error)}`);
      }
    },
  };

  sidebar = new MarketplaceViewProvider(context.extensionUri, apiDeps, hub);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refresh, () => refresh()),

    // Writing pvmp.sources fires onDidChangeConfiguration, which refreshes.
    vscode.commands.registerCommand(COMMANDS.addSource, () => addLocalSource()),

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

      await notify();

      const { updated, failed, skipped, reloadRequired } = result;
      if (updated + failed + skipped === 0) {
        void vscode.window.showInformationMessage('pvmp: everything is up to date.');
      }
      if (failed + skipped > 0) {
        const problems = [
          failed > 0 && `${failed} update(s) failed`,
          skipped > 0 && `${skipped} update(s) are waiting to retry after an earlier failure`,
        ].filter(Boolean);
        void vscode.window
          .showWarningMessage(`pvmp: ${problems.join(' and ')}.`, 'Show Log')
          .then((choice) => choice && channel.show(true));
      }
      if (reloadRequired) {
        void offerReload(`pvmp updated ${updated} extension(s). Reload to finish applying them.`);
      }
    }),
  );

  // Background check. It installs only when pvmp.autoUpdate is on (SPEC.md §9).
  let timer: ReturnType<typeof setInterval> | undefined;

  const restartTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;

    const { checkInterval } = readSettings();
    // `> 0` also rejects NaN and non-numeric strings from a hand-edited setting.
    if (!(checkInterval > 0)) {
      log.info('background update check is disabled');
      return;
    }

    // setInterval runs a longer delay every millisecond, so cap at ~24.8 days.
    timer = setInterval(() => void backgroundCheck(), Math.min(checkInterval * 1000, MAX_TIMER_MS));
    log.info(`background update check every ${checkInterval}s`);
  };

  const backgroundCheck = async (): Promise<void> => {
    try {
      const snapshot = await republish();
      const outdated = snapshot.entries.filter((entry) => entry.status === 'update-available');

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
    // The snapshot reads installed versions fresh, so this needs no re-list.
    vscode.extensions.onDidChange(() => void apiDeps.catalogChanged()),
  );

  restartTimer();
  void refresh();
}

export async function deactivate(): Promise<void> {
  DetailsPanel.disposeCurrent();
  try {
    await activeCache?.flush();
  } catch {
    // The window is closing and nothing can report this. A lost index costs
    // re-downloads; a rejected deactivate() shows an error nobody can act on.
  }
  activeCache = undefined;
}
