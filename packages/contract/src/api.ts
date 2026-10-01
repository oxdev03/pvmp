import type {
  CatalogSnapshot,
  ExtensionDetails,
  InstallProgress,
  InstallResult,
  SourceError,
} from './domain.ts';

/**
 * Everything the webview may ask the extension host to do.
 *
 * The client proxy and the host dispatcher both derive from this type, so a
 * method declared here but not implemented fails typechecking.
 *
 * A type alias because only aliases get the implicit index signature that
 * ApiShape requires; an interface would not satisfy it.
 */
export type HostApi = {
  listCatalog(): Promise<CatalogSnapshot>;
  getDetails(extensionId: string, version?: string): Promise<ExtensionDetails>;
  /** A webview URI for the icon, or undefined when the package has none (SPEC.md §6.3). */
  getIcon(extensionId: string, version: string): Promise<string | undefined>;
  install(extensionId: string, version: string): Promise<InstallResult>;
  uninstall(extensionId: string): Promise<InstallResult>;
  /** Re-reads every source, bypassing the metadata cache. */
  refresh(): Promise<void>;
  signIn(sourceId: string): Promise<void>;
  setPreReleaseOptIn(extensionId: string, on: boolean): Promise<void>;
  /** Opens the details panel for an extension (sidebar row click). */
  openExtension(extensionId: string): Promise<void>;
  openLog(): Promise<void>;
  addLocalSource(): Promise<void>;
};

/** Host-initiated notifications. Fire-and-forget, no response. */
export type HostEvents = {
  catalogChanged: () => void;
  installProgress: (progress: InstallProgress) => void;
  sourceError: (error: SourceError) => void;
};
