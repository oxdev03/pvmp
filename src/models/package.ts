import { Extension } from './extension';

export class Package {
  id: string;
  extensions: Extension[];
  installedVersion: string;
  selectedIndex: number = 0;

  constructor() {
    this.id = '';
    this.extensions = [];
    this.installedVersion = '';
  }

  get installedIndex() {
    const idx = this.extensions.findIndex((e) => e.identity.version === this.installedVersion);
    return idx === -1 ? undefined : idx;
  }

  get extension() {
    return this.extensions[this.selectedIndex];
  }

  addExtension(ext: Extension) {
    const existingExtensionIndex = this.extensions.findIndex((e) => e.identity.version === ext.identity.version);
    if (existingExtensionIndex !== -1) {
      if (ext.metadata.publishedAt > this.extensions[existingExtensionIndex].metadata.publishedAt) this.extensions[existingExtensionIndex] = ext;
    } else {
      this.extensions.push(ext);
    }
  }

  sort() {
    this.extensions.sort((a, b) => (a.identity.version > b.identity.version ? -1 : 1));
  }

  isUpdateAvailable(): boolean {
    if (!this.installedVersion) return false;
    const latestVersion = [this.installedVersion, ...this.extensions.map((x) => x.identity.version)].sort((a, b) => (a > b ? -1 : 1));
    return latestVersion[0] !== this.installedVersion;
  }

  isSelectedNewer(): boolean {
    if (!this.installedVersion) return false;
    const latestVersion = [this.installedVersion, this.extension.identity.version].sort((a, b) => (a > b ? -1 : 1));
    return latestVersion[0] !== this.installedVersion;
  }
}
