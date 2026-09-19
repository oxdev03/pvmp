import type * as vscode from 'vscode';

const PRE_RELEASE = 'preReleaseOptIn';
const FAILURES = 'installFailures';
const LAST_CHECK = 'lastCheck';

export interface InstallFailure {
  attempts: number;
  /** Epoch ms before which no retry is attempted. */
  until: number;
}

/**
 * Scratch state, in globalState rather than settings.
 *
 * v1 wrote its failed-update list into user settings, which conflates user
 * intent with bookkeeping and syncs the mess to every other machine
 * (SPEC.md §9). Settings hold only what the user chose.
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

  get lastCheck(): number {
    return this.memento.get<number>(LAST_CHECK, 0);
  }

  async setLastCheck(when: number): Promise<void> {
    await this.memento.update(LAST_CHECK, when);
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
    if (delete failures[`${extensionId}@${version}`]) {
      await this.memento.update(FAILURES, failures);
    }
  }
}
