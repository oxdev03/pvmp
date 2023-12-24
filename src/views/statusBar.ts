import { StatusBarAlignment, window } from 'vscode';

export function createStatusBar() {
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 10);
  statusBar.tooltip = 'No Updates Available';
  statusBar.text = '$(rocket) Up-to-Date';
  statusBar.command = 'pvmp.displayMarketplaceView';
  statusBar.show();
  return statusBar;
}
