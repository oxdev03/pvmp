import type * as vscode from 'vscode';

const PRE_RELEASE = 'preReleaseOptIn';
const FAILURES = 'installFailures';

export interface InstallFailure {
  attempts: number;
  /** Epoch ms before which no retry is attempted. */
  until: number;
}

/**
 * Bookkeeping in globalState. Settings hold only what you chose, and they
 * sync to your other machines (SPEC.md §9).
 */
export class ExtensionState {
  constructor(private readonly memento: vscode.Memento) {}

  get preReleaseOptIn(): Set<string> {
    return new Set(this.memento.get<string[]>(PRE_RELEASE, []));
  }

  async setPreReleaseOptIn(extensionId: string, on: boolean): Promise<void> {
    const current = this.preReleaseOptIn;
    if (on) current.add(extensionId);
    else current.delete(extensionId);
    await this.memento.update(PRE_RELEASE, [...current]);
  }

  #failures(): Record<string, InstallFailure> {
    return this.memento.get<Record<string, InstallFailure>>(FAILURES, {});
  }

  /** True while a previously failed install is still backing off. */
  isBackingOff(extensionId: string, version: string, now = Date.now()): boolean {
    const failure = this.#failures()[`${extensionId}@${version}`];
    return failure !== undefined && failure.until > now;
  }

  /** Exponential backoff, capped at roughly a day. */
  async recordFailure(extensionId: string, version: string, now = Date.now()): Promise<void> {
    const failures = this.#failures();
    const key = `${extensionId}@${version}`;
    const attempts = (failures[key]?.attempts ?? 0) + 1;
    const delay = Math.min(2 ** attempts * 60_000, 24 * 60 * 60 * 1000);
    failures[key] = { attempts, until: now + delay };
    await this.memento.update(FAILURES, failures);
  }

  async clearFailure(extensionId: string, version: string): Promise<void> {
    const failures = this.#failures();
    const key = `${extensionId}@${version}`;
    // `delete` returns true for a missing key too, so check first.
    if (!(key in failures)) return;
    delete failures[key];
    await this.memento.update(FAILURES, failures);
  }
}
