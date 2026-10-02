/**
 * Domain types shared by the extension host and the webview.
 *
 * These cross `postMessage`, which VS Code serializes as JSON: ISO strings
 * and plain objects, never `Date`, `Map` or class instances. An undefined
 * property vanishes, and an undefined array element becomes null.
 */

/** VS Code's `targetPlatform` values, plus `universal` for platform-agnostic builds. */
export type TargetPlatform =
  | 'universal'
  | 'win32-x64'
  | 'win32-arm64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'linux-armhf'
  | 'alpine-x64'
  | 'alpine-arm64'
  | 'darwin-x64'
  | 'darwin-arm64';

export const TARGET_PLATFORMS: readonly TargetPlatform[] = [
  'universal',
  'win32-x64',
  'win32-arm64',
  'linux-x64',
  'linux-arm64',
  'linux-armhf',
  'alpine-x64',
  'alpine-arm64',
  'darwin-x64',
  'darwin-arm64',
];

/** One concrete, installable version of an extension, from one source. */
export interface ExtensionVersion {
  extensionId: string;
  /** npm package name, e.g. `@corp/vsc-lint`. */
  packageName: string;
  version: string;
  targetPlatform: TargetPlatform;
  preRelease: boolean;
  /** `engines.vscode` range. */
  engine: string;
  displayName: string;
  publisher: string;
  publisherDisplayName: string;
  description: string;
  categories: string[];
  /** ISO 8601. Absent when the source cannot determine it. */
  publishedAt?: string;
  sourceId: string;
  /** Opaque locator the owning source uses to fetch bytes. */
  locator: string;
  /** Another source already provided this exact version at higher priority. */
  shadowed?: boolean;
}

export interface InstalledInfo {
  version: string;
  /**
   * Installed, but no configured source offers this version. Usually it came
   * from the public Marketplace.
   */
  external: boolean;
}

export type EntryStatus = 'available' | 'installed' | 'update-available';

/** One extension, merged across every source that offers it. */
export interface CatalogEntry {
  extensionId: string;
  displayName: string;
  publisher: string;
  publisherDisplayName: string;
  description: string;
  categories: string[];
  /** Compatibility-filtered and sorted newest-first. */
  versions: ExtensionVersion[];
  latest?: ExtensionVersion;
  installed?: InstalledInfo;
  status: EntryStatus;
  preReleaseOptIn: boolean;
}

export type SourceErrorKind = 'auth' | 'unreachable' | 'parse' | 'config' | 'unknown';

export interface SourceError {
  sourceId: string;
  kind: SourceErrorKind;
  message: string;
}

export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** Non-fatal per-source failures. A source that errored contributes no entries. */
  errors: SourceError[];
  vscodeVersion: string;
  targetPlatform: TargetPlatform;
}

export interface ExtensionLinks {
  repository?: string;
  homepage?: string;
  bugs?: string;
  license?: string;
}

export interface ExtensionDetails {
  entry: CatalogEntry;
  selectedVersion: string;
  /** Raw markdown; the webview renders and sanitizes it (SPEC.md §7.7). */
  readme?: string;
  changelog?: string;
  links: ExtensionLinks;
}

export type InstallPhase = 'downloading' | 'extracting' | 'installing' | 'done' | 'failed';

export interface InstallProgress {
  extensionId: string;
  version: string;
  phase: InstallPhase;
  message?: string;
}

export interface InstallResult {
  ok: boolean;
  reloadRequired: boolean;
  error?: string;
}
