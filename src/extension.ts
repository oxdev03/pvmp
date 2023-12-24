// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TreeViewProvider } from './views/treeViewProvider';
import { CONSTANTS } from './constants';
import { DetailsPanel } from './views/detailsPanel';
import { Extension } from './models/extension';
import { Package } from './models/package';
import { installExtension, uninstallExtension } from './utils';

// TODO: Update checker
// TODO: Auto Update
// TODO: Update to specific version
// TODO: publisher hover label
// TODO: Markdown local image support using base64

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "pvmp" is now active!');

  const extensionViewProvider = new TreeViewProvider();
  vscode.window.registerTreeDataProvider(CONSTANTS.treeView, extensionViewProvider);

  //register commands
  vscode.commands.registerCommand(CONSTANTS.cmdOpenSettings, async () => {
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:oxdev03.pvmp`);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdRefresh, () => extensionViewProvider.refresh());
  vscode.commands.registerCommand(CONSTANTS.cmdView, (pkg: Package) => {
    DetailsPanel.show(pkg, context.extensionUri);
    DetailsPanel.currentPanel?.update(pkg);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdInstall, async (pkg: Package) => {
    const installedVersion = await installExtension(pkg, context);
    if (installedVersion) {
      pkg.installedVersion = installedVersion;
      vscode.commands.executeCommand(CONSTANTS.cmdView, pkg);
    }
  });

  vscode.commands.registerCommand(CONSTANTS.cmdUninstall, async (pkg: Package) => {
    const uninstalled = await uninstallExtension(pkg);
    if (uninstalled) {
      pkg.installedVersion = '';
      DetailsPanel.currentPanel?.update(pkg);
    }
  });

  let addDirCmd = vscode.commands.registerCommand(CONSTANTS.cmdAddSource, async () => {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: 'Select Directory',
    });

    if (!result?.length) return;
    let existingPaths: string[] = (await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propSource)) || [];
    existingPaths.push(...result.map((x) => x.fsPath));

    const uniqPaths = [...new Set(existingPaths)];
    console.log(uniqPaths);

    await vscode.workspace.getConfiguration('').update(CONSTANTS.propSource, uniqPaths, vscode.ConfigurationTarget.Global);
    extensionViewProvider.refresh();
    vscode.window.showInformationMessage(`Updated Directory Sources`);
  });

  context.subscriptions.push(addDirCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {}
