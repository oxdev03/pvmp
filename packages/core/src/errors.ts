import type { SourceErrorKind } from '@pvmp/contract';

/** A failure attributable to one source, carrying the kind the UI switches on. */
export class SourceFailure extends Error {
  override readonly name = 'SourceFailure';
  constructor(
    readonly sourceId: string,
    readonly kind: SourceErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** A published package that does not satisfy the pvmp format (SPEC.md §2). */
export class ManifestError extends Error {
  override readonly name = 'ManifestError';
  constructor(
    readonly locator: string,
    message: string,
  ) {
    super(`${locator}: ${message}`);
  }
}

export function httpErrorKind(status: number): SourceErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500 || status === 408 || status === 429) return 'unreachable';
  return 'unknown';
}
