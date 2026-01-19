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

  const extensionViewProvider = new TreeViewProvider(context);

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
        context
      );
    }
  });

  vscode.commands.registerCommand(CONSTANTS.cmdBatchUpdate, async () => {
    const packages = await getPackages(getExtensionSources() || []);
    const length = packages.filter((x) => x.isUpdateAvailable()).length;
    if (!length) {
      return vscode.window.showInformationMessage('No Updates Available!');
    }
    await batchUpdateExtensions(
      packages.filter((x) => x.isUpdateAvailable()),
      context
    );
  });

  vscode.commands.registerCommand(CONSTANTS.cmdOpenSettings, () => {
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:oxdev03.pvmp`);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdRefresh, () => extensionViewProvider.refresh());

  vscode.commands.registerCommand(CONSTANTS.cmdView, (pkg: Package) => {
    DetailsPanel.show(pkg, context.extensionUri);
    DetailsPanel.currentPanel?.update(pkg);
  });

  vscode.commands.registerCommand(CONSTANTS.cmdUpdate, async (pkg: Package) => {
    // Mark the package as dirty before starting update
    extensionViewProvider.markPackageDirty(pkg);

    await vscode.commands.executeCommand(CONSTANTS.cmdInstall, pkg);

    // The dirty flag system will automatically update the tree node - no window reload needed
  });

  vscode.commands.registerCommand(CONSTANTS.cmdInstall, async (param: any) => {
    console.log(`Starting install for: ${param?.id}`);

    try {
      let pkg: Package;

      // Check if this is a TreeNode (from tree view) or Package (from details panel)
      if (param?.package) {
        // This is a TreeNode from tree view
        console.log('Received TreeNode from tree view');
        pkg = param.package;
      } else if (param?.extension) {
        // This is a Package from details panel
        console.log('Received Package from details panel');
        pkg = param;
      } else {
        console.error('Install command received invalid parameter');
        vscode.window.showErrorMessage('Invalid data for installation');
        return;
      }

      console.log('Package exists:', !!pkg);
      console.log('Package.extension exists:', !!pkg?.extension);
      console.log('Package.extension.extensionPath:', pkg?.extension?.extensionPath);

      console.log('About to call installExtension...');
      const installedVersion = await installExtension(pkg, context);
      console.log('installExtension returned:', installedVersion);

      if (installedVersion) {
        console.log(`Install succeeded for: ${pkg.id}, updating tree and details immediately`);

        // Update package state
        pkg.installedVersion = installedVersion;

        // Update tree node immediately
        const node = extensionViewProvider.getCachedNode(pkg.id);
        if (node) {
          console.log(`Found cached node, updating to installed state`);
          node.package.installedVersion = installedVersion;
          node.updateDisplay();

          // Fire change event for just this node
          extensionViewProvider.fireNodeChange(node);
        } else {
          console.log(`No cached node found, doing full refresh`);
          extensionViewProvider.refresh();
        }

        // Update details panel immediately with known install status
        if (DetailsPanel.currentPanel && DetailsPanel.isShowingPackage(pkg)) {
          console.log(`Updating details panel for installed: ${pkg.id}`);
          DetailsPanel.currentPanel.updateInstallStatus(pkg, true, installedVersion);
        }
      }
    } catch (error) {
      console.error('Error in install command:', error);
      vscode.window.showErrorMessage(`Install failed: ${error}`);
    }
  });

  vscode.commands.registerCommand(CONSTANTS.cmdUninstall, async (param: any) => {
    console.log(`Starting uninstall for: ${param?.id}`);

    try {
      let pkg: Package;

      // Check if this is a TreeNode (from tree view) or Package (from details panel)
      if (param?.package) {
        // This is a TreeNode from tree view
        console.log('Received TreeNode from tree view');
        pkg = param.package;
      } else if (param?.extension) {
        // This is a Package from details panel
        console.log('Received Package from details panel');
        pkg = param;
      } else {
        console.error('Uninstall command received invalid parameter');
        vscode.window.showErrorMessage('Invalid data for uninstallation');
        return;
      }

      console.log('About to call uninstallExtension...');
      const uninstalled = await uninstallExtension(pkg);

      if (uninstalled) {
        console.log(`Uninstall succeeded for: ${pkg.id}, updating tree immediately`);

        // Update the package object state immediately
        pkg.installedVersion = '';
        pkg.extension.metadata.identifier = '';

        // Since we know uninstall succeeded, immediately update the tree node
        const node = extensionViewProvider.getCachedNode(pkg.id);
        if (node) {
          console.log(`Found cached node, updating to uninstalled state`);
          node.package.installedVersion = '';
          node.package.extension.metadata.identifier = '';
          node.updateDisplay();

          // Fire change event for just this node
          extensionViewProvider.fireNodeChange(node);
        } else {
          console.log(`No cached node found, doing full refresh`);
          extensionViewProvider.refresh();
        }

        // Update details panel immediately too (direct status update)
        if (DetailsPanel.currentPanel && DetailsPanel.isShowingPackage(pkg)) {
          console.log(`Updating details panel for uninstalled: ${pkg.id}`);
          DetailsPanel.currentPanel.updateInstallStatus(pkg, false);
        }
      }
    } catch (error) {
      console.error('Error in uninstall command:', error);
      vscode.window.showErrorMessage(`Uninstall failed: ${error}`);
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

  const addAtomFeedCmd = vscode.commands.registerCommand(CONSTANTS.cmdAddAtomFeed, async () => {
    const feedUrl = await vscode.window.showInputBox({
      prompt: 'Enter Atom Feed URL',
      placeHolder: 'http://localhost:8624/vsix/vscode-extensions/atom.xml',
      validateInput: (value) => {
        if (!value) return 'URL is required';
        if (!value.startsWith('http://') && !value.startsWith('https://')) {
          return 'URL must start with http:// or https://';
        }
        if (!value.toLowerCase().includes('atom.xml')) {
          return 'URL should point to an atom.xml feed (e.g., .../atom.xml)';
        }
        return null;
      }
    });

    if (!feedUrl) return;

    const existingPaths: string[] = (await vscode.workspace.getConfiguration('')?.get(CONSTANTS.propSource)) || [];

    if (existingPaths.includes(feedUrl)) {
      vscode.window.showWarningMessage('This Atom feed is already configured');
      return;
    }

    existingPaths.push(feedUrl);

    await vscode.workspace
      .getConfiguration('')
      .update(CONSTANTS.propSource, existingPaths, vscode.ConfigurationTarget.Global);
    extensionViewProvider.refresh();
    vscode.window.showInformationMessage(`Added Atom feed: ${feedUrl}`);
  });

  context.subscriptions.push(addDirCmd, addAtomFeedCmd);

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(CONSTANTS.extensionDetailsView, {
      // eslint-disable-next-line @typescript-eslint/require-await
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
    started ? console.log(`Started Check Update Interval`) : console.log(`Update Checker is deactivated`)
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
        1000 * 60 * 60
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
