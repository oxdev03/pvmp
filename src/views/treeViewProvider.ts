import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

import { CONSTANTS } from '../constants';
import { Package } from '../models/package';
import { getExtensionSources, getPackages } from '../utils';

export class TreeViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | void> = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;
  private iconCache = new Map<string, string>(); // Cache for downloaded icons
  private context?: vscode.ExtensionContext;
  private cachedTreeNodes: TreeNode[] = []; // Cache tree nodes to enable targeted updates
  private dirtyNodes = new Set<string>(); // Track nodes that need status updates
  private updateTimer?: NodeJS.Timeout; // Timer for batched updates
  private retryCount = new Map<string, number>(); // Track retry attempts per package

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Get a cached node by package ID
   */
  getCachedNode(packageId: string): TreeNode | undefined {
    return this.cachedTreeNodes.find(n => n.package.id === packageId);
  }

  /**
   * Fire a change event for a specific node
   */
  fireNodeChange(node: TreeNode): void {
    this._onDidChangeTreeData.fire(node);
  }

  /**
   * Marks a package as needing a status update (dirty)
   */
  markPackageDirty(pkg: Package): void {
    console.log(`Marking package as dirty: ${pkg.id}`);
    this.dirtyNodes.add(pkg.id);
    
    // Schedule an update check in a moment (debounced)
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    
    this.updateTimer = setTimeout(() => {
      this.updateDirtyNodes();
    }, 3000); // Increased from 1.5s to 3s for VS Code to fully process changes
  }
  
  /**
   * Updates all dirty nodes by rescanning their installation status
   */
  private async updateDirtyNodes(): Promise<void> {
    if (this.dirtyNodes.size === 0) {
      console.log('No dirty nodes to update');
      return;
    }
    
    console.log(`Updating ${this.dirtyNodes.size} dirty nodes:`, Array.from(this.dirtyNodes));
    
    // Get current installation state from VS Code
    const { getAllInstalledExtensions } = await import('../utils.js');
    const allInstalledExtensions = getAllInstalledExtensions();
    console.log(`Found ${allInstalledExtensions.length} installed extensions`);
    
    const updatedNodes: TreeNode[] = [];
    
    for (const packageId of this.dirtyNodes) {
      console.log(`Processing dirty package: ${packageId}`);
      const node = this.cachedTreeNodes.find(n => n.package.id === packageId);
      if (node) {
        console.log(`Found cached node for: ${packageId}, current version: ${node.package.installedVersion}`);
        
        // Find matching installed extension
        const packageIdentifier = `${node.package.extension.metadata.publisher?.toLowerCase() || 'unknown'}.${node.package.id.toLowerCase()}`;
        console.log(`Looking for extension with identifier: ${packageIdentifier} or name: ${node.package.id.toLowerCase()}`);
        
        const matchingExtension = allInstalledExtensions.find((ext: {
          publisher: string;
          name: string;
          version: string;
          identifier: string;
        }) => {
          const matches = 
            ext.identifier.toLowerCase() === packageIdentifier || 
            ext.identifier.toLowerCase() === node.package.id.toLowerCase() ||
            ext.name?.toLowerCase() === node.package.id.toLowerCase() ||
            (ext.name?.toLowerCase() === node.package.id.toLowerCase() && 
             ext.publisher?.toLowerCase() === node.package.extension.metadata.publisher?.toLowerCase()) ||
            // Try reverse lookup - sometimes the identifier format differs
            ext.identifier.toLowerCase().endsWith(`.${node.package.id.toLowerCase()}`) ||
            // Match by display name if available
            (node.package.extension.name?.toLowerCase() === ext.name?.toLowerCase());
          
          if (matches) {
            console.log(`Found matching extension: ${ext.identifier} (${ext.version}) - matched by ${ext.identifier === packageIdentifier ? 'exact identifier' : 'fallback logic'}`);
          }
          return matches;
        });
        
        console.log(`Matching extension for ${packageId}:`, matchingExtension ? 'FOUND' : 'NOT FOUND');
        if (!matchingExtension) {
          console.log(`Available extensions:`, allInstalledExtensions.slice(0, 3).map(ext => `${ext.identifier} (${ext.name})`));
        }
        
        // Update the cached node's package with current installation state
        const oldVersion = node.package.installedVersion;
        if (matchingExtension) {
          node.package.installedVersion = matchingExtension.version || '';
          node.package.extension.metadata.identifier = matchingExtension.identifier;
          console.log(`Updated node ${packageId} - INSTALLED: ${node.package.installedVersion}`);
        } else {
          node.package.installedVersion = '';
          node.package.extension.metadata.identifier = '';
          console.log(`Updated node ${packageId} - UNINSTALLED (was: ${oldVersion})`);
        }
        
        // Only update display if status actually changed
        if (oldVersion !== node.package.installedVersion) {
          console.log(`Status changed for ${packageId}, updating display and adding to update list`);
          node.updateDisplay();
          updatedNodes.push(node);
          // Reset retry count on successful update
          this.retryCount.delete(packageId);
        } else {
          console.log(`No status change for ${packageId}, skipping display update`);
          
          // If this was an uninstall operation but extension is still showing as installed,
          // we might need to retry as VS Code may not have updated its registry yet
          if (oldVersion && matchingExtension) {
            const retries = this.retryCount.get(packageId) || 0;
            if (retries < 2) { // Retry up to 2 times
              console.log(`Extension still appears installed after uninstall, retrying (${retries + 1}/2)`);
              this.retryCount.set(packageId, retries + 1);
              // Use the existing debounced mechanism instead of direct recursion
              this.markPackageDirty({ id: packageId } as Package);
              continue; // Skip clearing this dirty flag
            } else {
              console.log(`Max retries reached for ${packageId}, giving up`);
              this.retryCount.delete(packageId);
            }
          }
        }
      } else {
        console.log(`No cached node found for dirty package: ${packageId}`);
      }
    }
    
    // Clear dirty flags
    this.dirtyNodes.clear();
    console.log(`Cleared dirty flags`);
    
    // Fire change events for updated nodes
    console.log(`Firing change events for ${updatedNodes.length} updated nodes`);
    if (updatedNodes.length > 0) {
      for (const node of updatedNodes) {
        console.log(`Firing change event for: ${node.package.id}`);
        this._onDidChangeTreeData.fire(node);
      }
    } else {
      console.log(`No nodes needed visual updates`);
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }
  
  getChildren(): Thenable<TreeNode[]> {
    return this.getData();
  }

  async getData(): Promise<TreeNode[]> {
    const packages = await getPackages(getExtensionSources() || []);
    vscode.commands.executeCommand(CONSTANTS.cmdUpdateBadge, packages);
    
    // Pre-process icons for packages with remote URLs
    const treeNodes = await Promise.all(packages.map(async pkg => {
      if (pkg.extension.assets.image && 
          (pkg.extension.assets.image.startsWith('http://') || pkg.extension.assets.image.startsWith('https://'))) {
        await this.cacheRemoteIcon(pkg);
      }
      return new TreeNode(pkg, this);
    }));
    
    // Sort tree nodes alphabetically by extension name (case-insensitive)
    treeNodes.sort((a, b) => {
      const nameA = a.package.extension.name.toLowerCase();
      const nameB = b.package.extension.name.toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    // Cache the tree nodes for targeted updates
    this.cachedTreeNodes = treeNodes;
    
    return treeNodes;
  }

  /**
   * Downloads and caches a remote icon as a data URL
   */
  private async cacheRemoteIcon(pkg: Package): Promise<void> {
    const iconUrl = pkg.extension.assets.image;
    if (!iconUrl) {
      return;
    }

    // Check if we already have this icon cached
    if (this.iconCache.has(iconUrl)) {
      // Apply the cached icon to the package
      pkg.extension.assets.image = this.iconCache.get(iconUrl)!;
      return;
    }

    try {
      console.log(`Downloading icon for ${pkg.id} from: ${iconUrl}`);
      
      const response = await fetch(iconUrl);
      if (!response.ok) {
        console.warn(`Failed to download icon for ${pkg.id}: ${response.status}`);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Determine MIME type from response headers or URL extension
      let mimeType = response.headers.get('content-type') || 'image/png';
      if (!mimeType.startsWith('image/')) {
        // Guess from URL extension
        if (iconUrl.toLowerCase().includes('.svg')) {
          mimeType = 'image/svg+xml';
        } else if (iconUrl.toLowerCase().includes('.jpg') || iconUrl.toLowerCase().includes('.jpeg')) {
          mimeType = 'image/jpeg';
        } else {
          mimeType = 'image/png';
        }
      }

      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      
      // Cache the data URL and update the extension's image asset
      this.iconCache.set(iconUrl, dataUrl);
      pkg.extension.assets.image = dataUrl;
      
      console.log(`Cached icon for ${pkg.id} as data URL (${buffer.length} bytes)`);
    } catch (error) {
      console.warn(`Failed to cache icon for ${pkg.id}:`, error);
    }
  }
}

class TreeNode extends vscode.TreeItem {
  public readonly package: Package;
  private treeProvider: TreeViewProvider;

  constructor(pkg: Package, treeProvider: TreeViewProvider) {
    super(pkg.extension.name, vscode.TreeItemCollapsibleState.None);
    this.package = pkg;
    this.treeProvider = treeProvider;
    this.id = pkg.id;
    
    this.updateDisplay();
  }

  /**
   * Updates the tree item display properties based on current package state
   */
  public updateDisplay(): void {
    // Use extension icon if available, otherwise fall back to theme icon
    this.iconPath = this.getIconPath(this.package);
    
    this.command = {
      command: CONSTANTS.cmdView,
      title: '',
      arguments: [this.package],
    };
    this.description = this.package.installedVersion ? (this.package.isUpdateAvailable() ? 'Update Available' : 'Up-to-Date') : '';
    this.tooltip = this.package.extension.metadata.description;
    this.contextValue = !this.package.installedVersion ? 'install' : this.package.isUpdateAvailable() ? 'update' : 'uninstall';
  }

  private getIconPath(pkg: Package): vscode.Uri | vscode.ThemeIcon {
    const imageAsset = pkg.extension.assets.image;
    
    if (!imageAsset) {
      console.log(`No icon for ${pkg.id}`);
      return this.getThemeIcon(pkg);
    }

    console.log(`Icon for ${pkg.id}: ${imageAsset.startsWith('data:') ? 'data URL' : imageAsset}`);

    try {
      if (imageAsset.startsWith('data:image/')) {
        // Base64 data URL - VS Code supports these directly in tree views
        console.log(`Using data URL icon for ${pkg.id}`);
        return vscode.Uri.parse(imageAsset);
      } else if (imageAsset.startsWith('file://') || (!imageAsset.startsWith('http'))) {
        // Local file path
        console.log(`Using local file icon for ${pkg.id}: ${imageAsset}`);
        return vscode.Uri.file(imageAsset.replace('file://', ''));
      } else {
        // This should not happen now since we convert remote URLs to data URLs
        console.warn(`Unexpected icon format for ${pkg.id}: ${imageAsset}`);
        return this.getThemeIcon(pkg);
      }
    } catch (error) {
      console.warn(`Failed to parse icon path for ${pkg.id}: ${imageAsset}`, error);
      return this.getThemeIcon(pkg);
    }
  }

  private getThemeIcon(pkg: Package): vscode.ThemeIcon {
    return new vscode.ThemeIcon(
      'extensions',
      pkg.isUpdateAvailable() ? new vscode.ThemeColor('privateMarketplace.updateIconColor') : undefined
    );
  }
}
