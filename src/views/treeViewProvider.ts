import * as vscode from 'vscode';
import { Extension } from '../models/extension';
import { CONSTANTS } from '../constants';
import { Package } from '../models/package';
import { getExtensionSources, getPackages } from '../utils';

export class TreeViewProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | void> = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Package): vscode.TreeItem {
    return new TreeNode(element);
  }
  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    return this.getData();
  }

  async getData(): Promise<Package[]> {
    const promises = (await getExtensionSources()).map((dirPath) => (dirPath ? getPackages(dirPath) : []));
    return (await Promise.all(promises)).flat();
  }
}

class TreeNode extends vscode.TreeItem {
  constructor(pkg: Package) {
    super(pkg.extension.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('extensions');
    this.command = {
      command: CONSTANTS.cmdView,
      title: '',
      arguments: [pkg],
    };
  }
}
