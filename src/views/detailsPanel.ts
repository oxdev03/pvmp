import markdownit from 'markdown-it';
import * as vscode from 'vscode';
import * as path from 'path';

import { CONSTANTS } from '../constants';
import { Package } from '../models/package';
import { getAllInstalledExtensions, getWebviewOptions } from '../utils';
import { AtomService } from '../services/atomService';

type WebViewMessage = {
  command: string;
  version?: string;
};

export class DetailsPanel {
  public static currentPanel?: DetailsPanel;
  private static currentPkg?: Package;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Checks if the details panel is currently showing the specified package
   */
  public static isShowingPackage(pkg: Package): boolean {
    return DetailsPanel.currentPkg?.id === pkg.id;
  }

  public static show(pkg: Package, extensionUri: vscode.Uri) {
    DetailsPanel.currentPkg = pkg;

    if (DetailsPanel.currentPanel) {
      DetailsPanel.currentPanel._panel.reveal(vscode.window?.activeTextEditor?.viewColumn);
      // Update with current package state (including fresh installed version check)
      DetailsPanel.currentPanel.update(pkg);
      return;
    }

    // new panel
    const panel = vscode.window.createWebviewPanel(
      CONSTANTS.extensionDetailsView,
      pkg.extension.name,
      vscode.ViewColumn.One,
      getWebviewOptions(extensionUri)
    );

    DetailsPanel.revive(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, uri: vscode.Uri) {
    DetailsPanel.currentPanel = new DetailsPanel(panel, uri);
    // Initialize with current package data if available
    if (DetailsPanel.currentPkg) {
      DetailsPanel.currentPanel.update(DetailsPanel.currentPkg);
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // panel dispose listener => dispose panel
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // handle messages from webview
    this._panel.webview.onDidReceiveMessage((message: WebViewMessage) => {
      switch (message.command) {
        case CONSTANTS.msgSelectVersion:
          this.selectVersion(message.version || '');
          break;
        case CONSTANTS.msgInstall:
          if (DetailsPanel.currentPkg) vscode.commands.executeCommand(CONSTANTS.cmdInstall, DetailsPanel.currentPkg);
          break;
        case CONSTANTS.msgUpdate:
          if (DetailsPanel.currentPkg) vscode.commands.executeCommand(CONSTANTS.cmdUpdate, DetailsPanel.currentPkg);
          break;
        case CONSTANTS.msgUninstall:
          if (DetailsPanel.currentPkg) vscode.commands.executeCommand(CONSTANTS.cmdUninstall, DetailsPanel.currentPkg);
          break;
      }
    });
  }

  private selectVersion(version: string) {
    if (DetailsPanel.currentPkg) {
      const newIndex = DetailsPanel.currentPkg.extensions.findIndex((x) => x.identity.version === version);
      if (newIndex === -1) {
        // error handling
      }
      DetailsPanel.currentPkg.selectedIndex = newIndex;
      this.update(DetailsPanel.currentPkg);
    }
  }

  public update(pkg: Package) {
    DetailsPanel.currentPkg = pkg;
    this._panel.title = pkg.extension.name;
    
    // Get all installed extensions and check for matches
    const installedExtensions = getAllInstalledExtensions();
    const matchingExtension = this.findMatchingInstalledExtension(pkg, installedExtensions);
    
    if (matchingExtension) {
      pkg.installedVersion = matchingExtension.version;
      // Update the package metadata with the correct identifier for future operations
      pkg.extension.metadata.identifier = matchingExtension.identifier;
      pkg.extension.metadata.publisher = matchingExtension.publisher;
      console.log(`Found installed extension: ${matchingExtension.identifier} v${matchingExtension.version}`);
    } else {
      pkg.installedVersion = '';
    }
    
    this._panel.webview.html = this._getHtmlForWebView(this._panel.webview, pkg);
  }

  /**
   * Directly updates the install status without re-checking VS Code's extension registry
   * Used when we know for certain an extension was just installed/uninstalled
   */
  public updateInstallStatus(pkg: Package, installed: boolean, version: string = '') {
    DetailsPanel.currentPkg = pkg;
    
    // Directly set the install status without checking VS Code's registry
    if (installed) {
      pkg.installedVersion = version;
      console.log(`Details panel: Set as installed v${version}`);
    } else {
      pkg.installedVersion = '';
      pkg.extension.metadata.identifier = '';
      console.log(`Details panel: Set as uninstalled`);
    }
    
    // Update the webview with the new status
    this._panel.webview.html = this._getHtmlForWebView(this._panel.webview, pkg);
  }

  /**
   * Finds a matching installed extension for the given package
   */
  private findMatchingInstalledExtension(pkg: Package, installedExtensions: Array<{publisher: string, name: string, version: string, identifier: string}>) {
    const packageName = pkg.extension.name.toLowerCase();
    const packageId = pkg.extension.id.toLowerCase();
    
    // Try multiple matching strategies
    for (const installed of installedExtensions) {
      const installedName = installed.name.toLowerCase();
      
      // Strategy 1: Direct name match
      if (packageName === installedName) {
        return installed;
      }
      
      // Strategy 2: Package ID matches extension name
      if (packageId === installedName) {
        return installed;
      }
      
      // Strategy 3: Match extension name part after the first dot (publisher.extensionname)
      const packageExtensionName = pkg.extension.metadata.identifier.includes('.') 
        ? pkg.extension.metadata.identifier.split('.').slice(1).join('.').toLowerCase()
        : packageId;
      const installedExtensionName = installed.identifier.includes('.') 
        ? installed.identifier.split('.').slice(1).join('.').toLowerCase()
        : installedName;
      
      if (packageExtensionName === installedExtensionName) {
        return installed;
      }
      
      // Strategy 4: Remove common prefixes/suffixes and compare
      const cleanPackageName = packageName.replace(/[-_](vscode|extension|ext)$/, '').replace(/^(vscode|ext)[-_]/, '');
      const cleanInstalledName = installedName.replace(/[-_](vscode|extension|ext)$/, '').replace(/^(vscode|ext)[-_]/, '');
      
      if (cleanPackageName === cleanInstalledName) {
        return installed;
      }
    }
    
    return null;
  }

  /**
   * Gets the current installed version of an extension from VS Code
   */
  private getCurrentInstalledVersion(identifier: string): string {
    const ext = vscode.extensions.getExtension(identifier);
    if (!ext?.packageJSON) return '';
    
    // Safely extract version
    const version = ext.packageJSON.version;
    return typeof version === 'string' ? version : '';
  }

  private _getHtmlForWebView(webview: vscode.Webview, pkg: Package): string {
    DetailsPanel.currentPkg = pkg;
    const webviewScript = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();
    const styleMain = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media/css', 'main.css'));
    const styleGithub = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'github-markdown.css'));

    const ext = pkg.extension;
    const md = markdownit();
    md.options.html = true;

    const updateSection =
      pkg.isUpdateAvailable() && pkg.isSelectedNewer()
        ? `<vscode-button id="updateBtn">Update to ${
            !pkg.selectedIndex ? 'Latest' : pkg.extension.identity.version
          }</vscode-button>`
        : !pkg.isSelectedNewer()
          ? `<vscode-button id="updateBtn">Install v${pkg.extension.identity.version}</vscode-button>`
          : '';

    return /* HTML */ `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${ext.name}</title>
          <link href="${styleMain.toString()}" rel="stylesheet" />
          <link href="${styleGithub.toString()}" rel="stylesheet" />
        </head>
        <body>
          <div class="container">
            <div class="head">
              <div class="img">
                <img src="${ext.assets.image}" />
              </div>
              <div class="head-info">
                <div class="title">
                  <h1>${ext.name}</h1>
                  <select class="version-dropdown" id="selectVersion">
                    ${pkg.extensions
                      .map(
                        (x, i) =>
                          `<option ${pkg.selectedIndex === i ? 'selected' : ''} value="${x.identity.version}">v${
                            x.identity.version
                          }</option>`
                      )
                      .join('\n')}
                  </select>
                  ${pkg.extension.identity.preRelease
                    ? '<vscode-tag class="prerelease-tag">Prerelease</vscode-tag>'
                    : ''}
                  ${pkg.extension.identity.preview ? '<vscode-tag class="preview-tag">Preview</vscode-tag>' : ''}
                </div>
                <label title="Publisher">${ext.metadata.publisher}</label>
                <div>${ext.metadata.description}</div>
                <div class="actions">
                  ${pkg.installedVersion
                    ? /* HTML */ `${updateSection} <vscode-button id="uninstallBtn">Uninstall</vscode-button>`
                    : /* HTML */ `<vscode-button id="installBtn">Install</vscode-button>`}
                </div>
              </div>
            </div>
            <div class="panel">
              <vscode-divider></vscode-divider>
              <vscode-panels>
                <vscode-panel-tab id="tab-1">DETAILS</vscode-panel-tab>
                <vscode-panel-tab id="tab-2">CHANGELOG</vscode-panel-tab>
                <vscode-panel-view id="view-1"
                  ><div class="markdown-body">${md.render(ext.assets.readme)}</div></vscode-panel-view
                >
                <vscode-panel-view id="view-2"
                  ><div class="markdown-body">${md.render(ext.assets.changelog)}</div></vscode-panel-view
                >
              </vscode-panels>
            </div>
            <div class="info">
              <vscode-divider></vscode-divider>
              <div class="categories">
                <h3>Categories</h3>
                <div>${ext.metadata.categories.map((x) => `<vscode-tag>${x}</vscode-tag>`).join('')}</div>
              </div>
              <br />
              <vscode-divider></vscode-divider>
              <div class="resources">
                <h3>Extension Resources</h3>
                <div>
                  ${ext.links.repository ? `<vscode-link href="${ext.links.repository}">Repository</vscode-link>` : ''}
                  ${ext.links.getStarted ? `<vscode-link href="${ext.links.getStarted}">Get Started</vscode-link>` : ''}
                  ${ext.links.learn ? `<vscode-link href="${ext.links.learn}">Learn</vscode-link>` : ''}
                  ${ext.links.support ? `<vscode-link href="${ext.links.support}">Support</vscode-link>` : ''}
                </div>
              </div>
              <br />
              <vscode-divider></vscode-divider>
              <div class="more-info">
                <h3>More Info</h3>
                <table>
                  <tr>
                    <td>Published</td>
                    <td>${ext.metadata.publishedAt.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>Identifier</td>
                    <td>${ext.metadata.identifier}</td>
                  </tr>
                  <tr>
                    <td>Installed</td>
                    <td>${(pkg.installedVersion && 'v' + pkg.installedVersion) || 'None'}</td>
                  </tr>
                  <tr>
                    <td>Platform</td>
                    <td>${pkg.extension.identity.target}</td>
                  </tr>
                  <tr>
                    <td>Package Source</td>
                    <td class="package-source" title="${ext.extensionPath}">${this.formatPackageSource(ext.extensionPath)}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
          <script nonce="${nonce}" src="${webviewScript.toString()}" type="module"></script>
        </body>
      </html>`;
  }

  /**
   * Formats the package source for display
   * @param extensionPath The extension path or URL
   * @returns Formatted source string
   */
  private formatPackageSource(extensionPath: string): string {
    if (AtomService.isAtomFeedUrl(extensionPath) || extensionPath.startsWith('http')) {
      // For Atom feed URLs, extract the base URL for cleaner display
      try {
        const url = new URL(extensionPath);
        return `Atom Feed (${url.host})`;
      } catch {
        return 'Atom Feed';
      }
    } else {
      // For local paths, show the directory name
      const dirName = path.basename(path.dirname(extensionPath));
      return `Local Directory (${dirName})`;
    }
  }

  public dispose() {
    DetailsPanel.currentPanel = undefined;
    DetailsPanel.currentPkg = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
