/**
 * Metrics from VS Code's own extension list.
 *
 * Sources (MIT, microsoft/vscode @ main):
 *   src/vs/workbench/contrib/extensions/browser/extensionsList.ts
 *     EXTENSION_LIST_ELEMENT_HEIGHT = 72
 *   src/vs/workbench/contrib/extensions/browser/media/extension.css
 *     .extension-list-item              padding-left: --vscode-spacing-size160
 *     .details > .header-container      height: 20px
 *     .header > .name                   font-weight: --vscode-fontWeight-semiBold
 *     .details > .description           color: --vscode-descriptionForeground
 *                                       padding-right: 8px
 *     .details > .footer                height: 24px
 *     .footer .publisher > .publisher-name
 *                                       font-size: 11px; semiBold
 *   src/vs/workbench/contrib/extensions/browser/media/extensionsWidgets.css
 *     .extension-icon                   36x36
 *   src/vs/workbench/contrib/extensions/browser/media/extensionsViewlet.css
 *     narrow .extension-icon .icon      24x24
 *     .icon-container                   padding-top: 10px
 *
 * Re-check them when raising the supported VS Code version (SPEC.md §7.3).
 */
export const METRICS = {
  rowHeight: 72,
  iconSize: 36,
  iconSizeNarrow: 24,
  headerHeight: 20,
  footerHeight: 24,
  /** --vscode-spacing-size160, with the value VS Code resolves it to today. */
  rowPaddingLeft: 'var(--vscode-spacing-size160, 16px)',
  semiBold: 'var(--vscode-fontWeight-semiBold, 600)',
} as const;
