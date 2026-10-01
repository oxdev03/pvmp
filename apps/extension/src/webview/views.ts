import type { HostApi, HostEvents, IpcHost } from '@pvmp/contract';
import { ROOT_EXTENSION_ID_ATTRIBUTE, serveIpc } from '@pvmp/contract';
import * as vscode from 'vscode';

import type { HostApiDeps } from './api.ts';
import { createHostApi, createWebviewTransport } from './api.ts';
import { buildWebviewHtml, webviewOptions } from './html.ts';

export const SIDEBAR_VIEW_ID = 'pvmp.marketplace';
export const DETAILS_VIEW_TYPE = 'pvmp.details';

type Host = IpcHost<HostEvents>;

/** Fans an event out to every live webview. */
export class WebviewHub {
  readonly #hosts = new Set<Host>();

  add(host: Host): vscode.Disposable {
    this.#hosts.add(host);
    return new vscode.Disposable(() => {
      host.dispose();
      this.#hosts.delete(host);
    });
  }

  emit<K extends keyof HostEvents & string>(event: K, ...args: Parameters<HostEvents[K]>): void {
    for (const host of this.#hosts) host.emit(event, ...args);
  }

  dispose(): void {
    for (const host of this.#hosts) host.dispose();
    this.#hosts.clear();
  }
}

function serve(webview: vscode.Webview, deps: HostApiDeps, hub: WebviewHub): vscode.Disposable {
  const api = createHostApi(deps, webview);
  const host = serveIpc<HostApi, HostEvents>(api, createWebviewTransport(webview), {
    onError: (method, error) => deps.log.error(`ipc ${method} failed: ${String(error)}`),
  });
  return hub.add(host);
}

/** The activity-bar list. Replaces v1's TreeView entirely (SPEC.md §7.1). */
export class MarketplaceViewProvider implements vscode.WebviewViewProvider {
  #view: vscode.WebviewView | undefined;
  #badge = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: HostApiDeps,
    private readonly hub: WebviewHub,
  ) {}

  /**
   * The activity-bar badge counting available updates.
   *
   * Remembered, because the first refresh usually finishes before VS Code
   * resolves the view, and a badge set on no view was simply lost.
   */
  setBadge(count: number): void {
    this.#badge = count;
    if (!this.#view) return;
    this.#view.badge =
      count > 0 ? { value: count, tooltip: `${count} update(s) available` } : undefined;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    this.setBadge(this.#badge);
    view.webview.options = webviewOptions(this.extensionUri, this.deps.storage);
    view.webview.html = buildWebviewHtml({
      webview: view.webview,
      extensionUri: this.extensionUri,
      entry: 'sidebar',
      title: 'Private Marketplace',
    });
    const served = serve(view.webview, this.deps, this.hub);
    view.onDidDispose(() => {
      served.dispose();
      this.#view = undefined;
    });
  }
}

/**
 * The details editor tab.
 *
 * One panel, reused: opening a second extension retargets the existing panel,
 * which is how VS Code's own extension editor behaves.
 */
export class DetailsPanel {
  private static current: DetailsPanel | undefined;

  static show(
    extensionId: string,
    extensionUri: vscode.Uri,
    deps: HostApiDeps,
    hub: WebviewHub,
  ): void {
    const existing = DetailsPanel.current;
    if (existing) {
      existing.retarget(extensionId);
      existing.panel.reveal(undefined, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DETAILS_VIEW_TYPE,
      extensionId,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { ...webviewOptions(extensionUri, deps.storage), retainContextWhenHidden: false },
    );

    DetailsPanel.current = new DetailsPanel(panel, extensionId, extensionUri, deps, hub);
  }

  static disposeCurrent(): void {
    DetailsPanel.current?.panel.dispose();
    DetailsPanel.current = undefined;
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private extensionId: string,
    private readonly extensionUri: vscode.Uri,
    private readonly deps: HostApiDeps,
    hub: WebviewHub,
  ) {
    this.render();
    this.disposables.push(serve(panel.webview, deps, hub));
    panel.onDidDispose(() => {
      for (const disposable of this.disposables) disposable.dispose();
      DetailsPanel.current = undefined;
    });
  }

  private retarget(extensionId: string): void {
    if (this.extensionId === extensionId) return;
    this.extensionId = extensionId;
    this.render();
  }

  private render(): void {
    this.panel.title = this.extensionId;
    void this.#retitle(this.extensionId);
    this.panel.webview.html = buildWebviewHtml({
      webview: this.panel.webview,
      extensionUri: this.extensionUri,
      entry: 'details',
      title: this.extensionId,
      rootData: { [ROOT_EXTENSION_ID_ATTRIBUTE]: this.extensionId },
    });
  }

  /** "Extension: Corp Lint", as VS Code titles its own extension editor. */
  async #retitle(extensionId: string): Promise<void> {
    try {
      const { entries } = await this.deps.catalog.snapshot();
      const entry = entries.find((candidate) => candidate.extensionId === extensionId);
      // Retargeted while the catalog loaded: that render owns the title now.
      if (entry && this.extensionId === extensionId) {
        this.panel.title = `Extension: ${entry.displayName}`;
      }
    } catch {
      // The id is already the title; a failed catalog is reported elsewhere.
    }
  }
}
