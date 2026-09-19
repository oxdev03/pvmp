/**
 * Domain types shared by the extension host and the webview.
 *
 * Everything here must be structured-clone safe: it crosses `postMessage`.
 * No `Date`, no `Map`, no class instances — ISO strings and plain objects.
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

/**
 * The `pvmp` block a published npm package must carry.
 *
 * It exists because a few fields live only in `extension.vsixmanifest`, and
 * pvmp deliberately never parses that file — see SPEC.md §2.
 */
export interface PvmpBlock {
  /** `publisher.name`, exactly as VS Code identifies the extension. */
  extensionId: string;
  displayName: string;
  publisherDisplayName?: string;
  targetPlatform?: TargetPlatform;
  preRelease?: boolean;
}

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
   * True when VS Code reports this extension installed but no configured
   * source offers that version — e.g. it came from the public marketplace.
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
  /** Raw markdown. Rendered and sanitized in the webview — see SPEC.md §7.7. */
  readme?: string;
  changelog?: string;
  links: ExtensionLinks;
}

export type InstallPhase =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'failed';

export interface InstallProgress {
  extensionId: string;
  version: string;
  phase: InstallPhase;
  /** 0..1 when the source reports a content length. */
  pct?: number;
  message?: string;
}

export interface InstallResult {
  ok: boolean;
  reloadRequired: boolean;
  error?: string;
}
