import * as vscode from 'vscode';

export type WebviewEntry = 'sidebar' | 'details';

export interface HtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  entry: WebviewEntry;
  title: string;
  /**
   * Attributes to set on #root, keyed by their full attribute name.
   *
   * Full names rather than dataset keys on purpose: the HTML parser
   * lowercases attribute names, so a camelCase key silently becomes
   * unreadable through `dataset`. Use the constants in @pvmp/contract.
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
        // Fail loudly rather than emit an attribute the webview cannot read.
        throw new Error(
          `Root attribute "${name}" must be lowercase kebab-case starting with "data-"`,
        );
      }
      return ` ${name}="${escapeAttribute(value)}"`;
    })
    .join('');

  /*
   * script-src carries both a nonce and cspSource.
   *
   * The nonce authorises the entry <script>. The entry is an ES module that
   * statically imports a shared chunk, and CSP does not propagate a nonce to
   * imported modules, so the chunk needs its own allowance. cspSource is the
   * webview's private origin, and localResourceRoots below restricts that
   * origin to this extension's own bundle and cache directories, so nothing
   * else can be loaded through it.
   *
   * img-src additionally allows https: and data: because README content is
   * rendered here; it is sanitized in the webview as the other layer
   * (SPEC.md §7.7).
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

/**
 * The webview may read this extension's bundle and its metadata cache — the
 * cache is where extension icons live, served by URI rather than inlined as
 * base64 data URIs the way v1 did (SPEC.md §6).
 */
export function webviewOptions(
  extensionUri: vscode.Uri,
  storageUri: vscode.Uri,
): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), storageUri],
  };
}
