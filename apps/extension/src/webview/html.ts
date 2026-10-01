import * as vscode from 'vscode';

export type WebviewEntry = 'sidebar' | 'details';

export interface HtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  entry: WebviewEntry;
  title: string;
  /**
   * Attributes for #root, keyed by full attribute name. Use the constants in
   * @pvmp/contract: the HTML parser lowercases attribute names, so a
   * camelCase key would be unreadable through `dataset`.
   */
  rootData?: Record<string, string>;
}

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

export function buildWebviewHtml(options: HtmlOptions): string {
  const { webview, extensionUri, entry, title, rootData = {} } = options;
  const assets = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(assets, `${entry}.js`));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(assets, 'style.css'));
  const token = nonce();

  const data = Object.entries(rootData)
    .map(([name, value]) => {
      if (!/^data-[a-z0-9-]+$/.test(name)) {
        throw new Error(
          `Root attribute "${name}" must be lowercase kebab-case starting with "data-"`,
        );
      }
      return ` ${name}="${escapeAttribute(value)}"`;
    })
    .join('');

  /*
   * script-src needs the nonce for the entry <script> and cspSource for the
   * chunk it imports, because CSP does not pass a nonce on to imported
   * modules. cspSource can only reach localResourceRoots: this extension's
   * bundle and its cache.
   *
   * img-src allows https: and data: for images in READMEs, which the webview
   * sanitizes (SPEC.md §7.7).
   */
  const csp = [
    `default-src 'none'`,
    `script-src 'nonce-${token}' ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
    `connect-src 'none'`,
  ].join('; ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${style.toString()}" rel="stylesheet" />
    <title>${escapeAttribute(title)}</title>
  </head>
  <body>
    <div id="root"${data}></div>
    <script nonce="${token}" type="module" src="${script.toString()}"></script>
  </body>
</html>`;
}

/** The webview may load this extension's bundle and the cache, where icons live (SPEC.md §6). */
export function webviewOptions(
  extensionUri: vscode.Uri,
  storageUri: vscode.Uri,
): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), storageUri],
  };
}
