import * as vscode from 'vscode';

import { CONSTANTS } from './constants';
import { Package } from './models/package';
import {
  batchUpdateExtensions,
  getExtensionSources,
  getPackages,
  getWebviewOptions,
  installExtension,
  uninstallExtension,
} from './utils';
import { DetailsPanel } from './views/detailsPanel';
import { TreeViewProvider } from './views/treeViewProvider';

// TODO: check vscode engine

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "pvmp" is now active!');

  const extensionViewProvider = new TreeViewProvider();

  const treeView = vscode.window.createTreeView(CONSTANTS.treeView, {
    treeDataProvider: extensionViewProvider,
  });

  context.subscriptions.push(treeView);

  vscode.commands.registerCommand(CONSTANTS.cmdUpdateBadge, async (pkgs: Package[]) => {
    const length = pkgs.filter((x) => x.isUpdateAvailable()).length;
    treeView.badge = { tooltip: length ? 'Updates Available' : '', value: length };

    const autoUpdate = (await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propAutoUpdate)) || false;
    if (autoUpdate && length) {
      await batchUpdateExtensions(
        pkgs.filter((x) => x.isUpdateAvailable()),
        context,
      );
    }
  });

  vscode.commands.registerCommand(CONSTANTS.cmdBatchUpdate, async () => {
    const packages = await getPackages((await getExtensionSources()) || []);
    const length = packages.filter((x) => x.isUpdateAvailable()).length;
    if (!length) {
      return vscode.window.showInformationMessage('No Updates Available!');
    }
    await batchUpdateExtensions(
      packages.filter((x) => x.isUpdateAvailable()),
      context,
    );
  });

  vscode.commands.registerCommand(CONSTANTS.cmdOpenSettings, async () => {
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:oxdev03.pvmp`);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdRefresh, () => extensionViewProvider.refresh());

  vscode.commands.registerCommand(CONSTANTS.cmdView, (pkg: Package) => {
    DetailsPanel.show(pkg, context.extensionUri);
    DetailsPanel.currentPanel?.update(pkg);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdUpdate, async (pkg: Package) => {
    await vscode.commands.executeCommand(CONSTANTS.cmdInstall, pkg);
    vscode.commands.executeCommand('workbench.action.reloadWindow');
  });

  vscode.commands.registerCommand(CONSTANTS.cmdInstall, async (pkg: Package) => {
    const installedVersion = await installExtension(pkg, context);
    if (installedVersion) {
      pkg.installedVersion = installedVersion;

      DetailsPanel.currentPanel?.update(pkg);
      extensionViewProvider.refresh();
    }
  });

  vscode.commands.registerCommand(CONSTANTS.cmdUninstall, async (pkg: Package) => {
    const uninstalled = await uninstallExtension(pkg);
    if (uninstalled) {
      pkg.installedVersion = '';

      DetailsPanel.currentPanel?.update(pkg);
      extensionViewProvider.refresh();
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });

  const addDirCmd = vscode.commands.registerCommand(CONSTANTS.cmdAddSource, async () => {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: 'Select Directory',
    });

    if (!result?.length) return;
    const existingPaths: string[] = (await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propSource)) || [];
    existingPaths.push(...result.map((x) => x.fsPath));

    const uniqPaths = [...new Set(existingPaths)];
    console.log(uniqPaths);

    await vscode.workspace
      .getConfiguration('')
      .update(CONSTANTS.propSource, uniqPaths, vscode.ConfigurationTarget.Global);
    extensionViewProvider.refresh();
    vscode.window.showInformationMessage(`Updated Directory Sources`);
  });

  context.subscriptions.push(addDirCmd);

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(CONSTANTS.extensionDetailsView, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        webviewPanel.webview.options = getWebviewOptions(context.extensionUri);
        DetailsPanel.revive(webviewPanel, context.extensionUri);
      },
    });
  }

  let updateCheckerId: undefined | NodeJS.Timeout = undefined;

  context.subscriptions.push({
    dispose() {
      if (updateCheckerId) clearInterval(updateCheckerId);
    },
  });

  startCheckUpdateInterval().then((started) =>
    started ? console.log(`Started Check Update Interval`) : console.log(`Update Checker is deactivated`),
  );

  async function startCheckUpdateInterval(): Promise<boolean> {
    const checkUpdate = (await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propCheckUpdate)) || false;
    if (!checkUpdate && updateCheckerId) clearInterval(updateCheckerId);
    else if (!updateCheckerId && checkUpdate) {
      updateCheckerId = setInterval(
        () => {
          console.log('Checking for Updates');
          extensionViewProvider.refresh();
        },
        1000 * 60 * 60,
      );

      return true;
    }
    return false;
  }

  vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration(CONSTANTS.propCheckUpdate)) {
      await startCheckUpdateInterval();
    }
  });
}

// This method is called when your extension is deactivated
export function deactivate() {}
