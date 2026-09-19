import * as vscode from 'vscode';

const PREFIX = 'pvmp.token.';

/**
 * Bearer tokens in SecretStorage, which is the OS keychain (SPEC.md §4.3).
 *
 * Never settings: those sync between machines and end up in dotfile repos.
 * `.npmrc` is deliberately not read either.
 */
export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  get(sourceId: string): Thenable<string | undefined> {
    return this.secrets.get(PREFIX + sourceId);
  }

  store(sourceId: string, token: string): Thenable<void> {
    return this.secrets.store(PREFIX + sourceId, token);
  }

  delete(sourceId: string): Thenable<void> {
    return this.secrets.delete(PREFIX + sourceId);
  }

  /** Prompts for a token. Returns true when one was stored. */
  async prompt(sourceId: string): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      title: `Sign in to ${sourceId}`,
      prompt: `Bearer token for the "${sourceId}" registry`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Paste an identity or access token',
    });

    if (token === undefined) return false;
    if (token.trim().length === 0) {
      await this.delete(sourceId);
      return false;
    }

    await this.store(sourceId, token.trim());
    return true;
  }
}
