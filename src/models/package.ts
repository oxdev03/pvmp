import { Extension } from './extension';

/**
 * Represents a package with multiple extensions.
 */
export class Package {
  /**
   * The ID of the package.
   */
  id: string;

  /**
   * The list of extensions associated with the package.
   */
  extensions: Extension[];

  /**
   * The version of the currently installed extension.
   */
  installedVersion: string;

  /**
   * The index of the selected extension within the `extensions` array.
   */
  selectedIndex: number = 0;

  /**
   * Creates an instance of the Package class.
   */
  constructor() {
    this.id = '';
    this.extensions = [];
    this.installedVersion = '';
  }

  /**
   * Gets the index of the installed extension within the `extensions` array.
   * @returns {number | undefined} The index of the installed extension or undefined if not found.
   */
  get installedIndex(): number | undefined {
    const idx = this.extensions.findIndex((e) => e.identity.version === this.installedVersion);
    return idx === -1 ? undefined : idx;
  }

  /**
   * Gets the currently selected extension.
   * @returns {Extension} The currently selected extension.
   */
  get extension(): Extension {
    return this.extensions[this.selectedIndex];
  }

  /**
   * Adds an extension to the package. If an extension with the same version exists,
   * it is replaced only if the new extension has a more recent published date.
   * @param {Extension} ext - The extension to add.
   */
  addExtension(ext: Extension): void {
    const existingExtensionIndex = this.extensions.findIndex((e) => e.identity.version === ext.identity.version);
    if (existingExtensionIndex !== -1) {
      if (ext.metadata.publishedAt > this.extensions[existingExtensionIndex].metadata.publishedAt)
        this.extensions[existingExtensionIndex] = ext;
    } else {
      this.extensions.push(ext);
    }
  }

  /**
   * Sorts the extensions in descending order based on their version.
   */
  sort(): void {
    this.extensions.sort((a, b) => (a.identity.version > b.identity.version ? -1 : 1));
  }

  /**
   * Checks if there is an update available for the package.
   * @returns {boolean} True if an update is available, false otherwise.
   */
  isUpdateAvailable(): boolean {
    if (!this.installedVersion) return false;
    const latestVersion = [this.installedVersion, ...this.extensions.map((x) => x.identity.version)].sort((a, b) =>
      a > b ? -1 : 1,
    );
    return latestVersion[0] !== this.installedVersion;
  }

  /**
   * Checks if the currently selected extension is newer than the installed version.
   * @returns {boolean} True if the selected extension is newer, false otherwise.
   */
  isSelectedNewer(): boolean {
    if (!this.installedVersion) return false;
    const latestVersion = [this.installedVersion, this.extension.identity.version].sort((a, b) => (a > b ? -1 : 1));
    return latestVersion[0] !== this.installedVersion;
  }
}
