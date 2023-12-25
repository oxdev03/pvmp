import * as vscode from 'vscode';

import { CONSTANTS } from '../constants';
import { Package } from '../models/package';
import { getExtensionSources, getPackages } from '../utils';

export class TreeViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | void> = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Package): vscode.TreeItem {
    return new TreeNode(element);
  }
  getChildren(): Thenable<TreeNode[]> {
    return this.getData();
  }

  async getData(): Promise<Package[]> {
    const packages = await getPackages((await getExtensionSources()) || []);
    vscode.commands.executeCommand(CONSTANTS.cmdUpdateBadge, packages.filter((x) => x.isUpdateAvailable()).length);
    return packages;
  }
}

class TreeNode extends vscode.TreeItem {
  constructor(pkg: Package) {
    super(pkg.extension.name, vscode.TreeItemCollapsibleState.None);
    this.id = pkg.id;
    this.iconPath = new vscode.ThemeIcon(
      'extensions',
      pkg.isUpdateAvailable() ? new vscode.ThemeColor('privateMarketplace.updateIconColor') : undefined,
    );
    this.command = {
      command: CONSTANTS.cmdView,
      title: '',
      arguments: [pkg],
    };
    this.description = pkg.installedVersion ? (pkg.isUpdateAvailable() ? 'Update Available' : 'Up-to-Date') : '';
    this.tooltip = pkg.extension.metadata.description;
    this.contextValue = !pkg.installedVersion ? 'install' : pkg.isUpdateAvailable() ? 'update' : 'uninstall';
  }
}
