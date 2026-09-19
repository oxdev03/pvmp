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
 * This interface is the single source of truth for the wire: the client proxy
 * and the host dispatcher are both derived from it, so adding a method without
 * implementing it is a type error rather than a runtime 'unknown method'.
 */
export interface HostApi {
  listCatalog(): Promise<CatalogSnapshot>;
  getDetails(extensionId: string, version?: string): Promise<ExtensionDetails>;
  /**
   * Resolves to a webview-safe URI for the extension icon, or undefined when
   * the package ships none. Fetched lazily per visible row — see SPEC.md §6.3.
   */
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
}

/** Host-initiated notifications. Fire-and-forget, no response. */
export interface HostEvents {
  catalogChanged: () => void;
  installProgress: (progress: InstallProgress) => void;
  sourceError: (error: SourceError) => void;
}
