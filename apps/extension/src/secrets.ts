import * as vscode from 'vscode';

const PREFIX = 'pvmp.token.';

/**
 * Tokens, or `username:password`, in SecretStorage, which is the OS keychain
 * (SPEC.md §4.3).
 * Settings sync between machines and end up in dotfile repos, so tokens never
 * go there. pvmp does not read `.npmrc`.
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

  /** Prompts for a secret. Returns true when one was stored. */
  async prompt(sourceId: string): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      title: `Sign in to ${sourceId}`,
      prompt: `Token for the "${sourceId}" registry, or username:password (Nexus needs the latter)`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Paste an access token, or type username:password',
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
