/* eslint-disable */
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeTag,
  vsCodePanelTab,
  vsCodePanelView,
  vsCodePanels,
  vsCodeDivider,
  vsCodeLink,
} from '@vscode/webview-ui-toolkit';

const vscode = acquireVsCodeApi();
provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeTag(),
  vsCodePanelTab(),
  vsCodePanelView(),
  vsCodePanels(),
  vsCodeDivider(),
  vsCodeLink()
);

window.addEventListener('load', main);
function main() {
  const select = document.getElementById('selectVersion');
  select.addEventListener('change', selectVersion);

  const installBtn = document.getElementById('installBtn');
  if (installBtn) installBtn.addEventListener('click', install);

  const uninstallBtn = document.getElementById('uninstallBtn');
  if (uninstallBtn) uninstallBtn.addEventListener('click', uninstall);

  const updateBtn = document.getElementById('updateBtn');
  if (updateBtn) updateBtn.addEventListener('click', update);
}

function selectVersion(event) {
  vscode.postMessage({
    command: 'select-version',
    version: event.target.value,
  });
}

function install() {
  vscode.postMessage({
    command: 'install',
  });
}

function update() {
  vscode.postMessage({
    command: 'update',
  });
}

function uninstall() {
  vscode.postMessage({
    command: 'uninstall',
  });
}
