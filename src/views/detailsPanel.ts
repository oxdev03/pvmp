import markdownit from 'markdown-it';
import * as vscode from 'vscode';

import { CONSTANTS } from '../constants';
import { Package } from '../models/package';

export class DetailsPanel {
  public static currentPanel?: DetailsPanel;
  private static currentPkg?: Package;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static show(pkg: Package, extensionUri: vscode.Uri) {
    DetailsPanel.currentPkg = pkg;

    if (DetailsPanel.currentPanel) {
      DetailsPanel.currentPanel._panel.reveal(vscode.window?.activeTextEditor?.viewColumn);
      return;
    }

    // new panel
    const panel = vscode.window.createWebviewPanel(CONSTANTS.extensionDetailsView, pkg.extension.name, vscode.ViewColumn.One, {
      enableScripts: true,
    });

    DetailsPanel.revive(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, uri: vscode.Uri) {
    DetailsPanel.currentPanel = new DetailsPanel(panel, uri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // panel dispose listener => dispose panel
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // handle messages from webview
    this._panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case CONSTANTS.msgSelectVersion:
          this.selectVersion(message.version);
          break;
        case CONSTANTS.msgInstall:
          if (DetailsPanel.currentPkg) vscode.commands.executeCommand(CONSTANTS.cmdInstall, DetailsPanel.currentPkg);
          break;
        case CONSTANTS.msgUninstall:
          if (DetailsPanel.currentPkg) vscode.commands.executeCommand(CONSTANTS.cmdUninstall, DetailsPanel.currentPkg);
          break;
      }
    });
  }

  private selectVersion(version: any) {
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
    this._panel.webview.html = this._getHtmlForWebView(this._panel.webview, pkg);
  }

  private _getHtmlForWebView(webview: vscode.Webview, pkg: Package): string {
    DetailsPanel.currentPkg = pkg;
    const webviewScript = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));

    // Use a nonce to only allow a specific script to be run.
    const nonce = getNonce();
    const styleMain = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src/media/css', 'main.css'));
    const styleGithub = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'github-markdown.css'));

    const ext = pkg.extension;
    const md = markdownit();
    md.options.html = true;

    return /* HTML */ `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${ext.name}</title>
          <link href="${styleMain}" rel="stylesheet" />
          <link href="${styleGithub}" rel="stylesheet" />
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
                    ${pkg.extensions.map((x, i) => `<option ${pkg.selectedIndex === i ? 'selected' : ''} value="${x.identity.version}">v${x.identity.version}</option>`).join('\n')}
                  </select>
                  ${pkg.extension.identity.preRelease ? '<vscode-tag class="prerelease-tag">Prerelease</vscode-tag>' : ''}
                  ${pkg.extension.identity.preview ? '<vscode-tag class="preview-tag">Preview</vscode-tag>' : ''}
                </div>
                <label title="Publisher">${ext.metadata.publisher}</label>
                <div>${ext.metadata.description}</div>
                <div class="actions">
                  ${pkg.installedVersion ? /* HTML */ `<vscode-button id="uninstallBtn">Uninstall</vscode-button>` : /* HTML */ `<vscode-button id="installBtn">Install</vscode-button>`}
                </div>
              </div>
            </div>
            <div class="panel">
              <vscode-divider></vscode-divider>
              <vscode-panels>
                <vscode-panel-tab id="tab-1">DETAILS</vscode-panel-tab>
                <vscode-panel-tab id="tab-2">CHANGELOG</vscode-panel-tab>
                <vscode-panel-view id="view-1"><div class="markdown-body">${md.render(ext.assets.readme)}</div></vscode-panel-view>
                <vscode-panel-view id="view-2"><div class="markdown-body">${md.render(ext.assets.changelog)}</div></vscode-panel-view>
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
                  ${ext.links.learn ? `<vscode-link href="${ext.links.learn}">Learn</vscode-link>` : ''} ${ext.links.support ? `<vscode-link href="${ext.links.support}">Support</vscode-link>` : ''}
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
                </table>
              </div>
            </div>
          </div>
          <script nonce="${nonce}" src="${webviewScript}" type="module"></script>
        </body>
      </html>`;
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
