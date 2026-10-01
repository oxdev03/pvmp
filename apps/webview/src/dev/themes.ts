/**
 * Theme variables for the standalone harness.
 *
 * VS Code injects `--vscode-*` colours into real webviews. The harness has
 * no VS Code, so this file supplies the Dark Modern, Light Modern and Dark
 * High Contrast values for the tokens the UI reads (SPEC.md §7.3).
 */
export type ThemeName = 'dark' | 'light' | 'hc';

const SHARED: Record<string, string> = {
  'font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, sans-serif",
  'font-size': '13px',
  'font-weight': '400',
  'fontWeight-semiBold': '600',
  'editor-font-family': "'SF Mono', Menlo, Consolas, monospace",
  'spacing-size160': '16px',
};

const DARK: Record<string, string> = {
  foreground: '#cccccc',
  descriptionForeground: '#9d9d9d',
  errorForeground: '#f48771',
  focusBorder: '#0078d4',
  'editor-background': '#1f1f1f',
  'editorWidget-background': '#202020',
  'icon-foreground': '#cccccc',
  'panel-border': '#2b2b2b',
  'sideBar-background': '#181818',
  'sideBarSectionHeader-background': '#181818',
  'sideBarSectionHeader-foreground': '#cccccc',
  'list-hoverBackground': '#2a2d2e',
  'list-activeSelectionBackground': '#04395e',
  'list-activeSelectionForeground': '#ffffff',
  'button-background': '#0078d4',
  'button-foreground': '#ffffff',
  'button-hoverBackground': '#026ec1',
  'extensionButton-prominentBackground': '#0078d4',
  'extensionButton-prominentForeground': '#ffffff',
  'extensionButton-prominentHoverBackground': '#026ec1',
  'extensionButton-background': '#313131',
  'extensionButton-foreground': '#cccccc',
  'extensionButton-hoverBackground': '#3c3c3c',
  'extensionBadge-remoteBackground': '#0078d4',
  'extensionBadge-remoteForeground': '#ffffff',
  'badge-background': '#616161',
  'badge-foreground': '#f8f8f8',
  'dropdown-background': '#313131',
  'dropdown-foreground': '#cccccc',
  'dropdown-border': '#3c3c3c',
  'textLink-foreground': '#4daafc',
  'textLink-activeForeground': '#4daafc',
  'textCodeBlock-background': '#2b2b2b',
  'textBlockQuote-background': '#222222',
  'textBlockQuote-border': '#0078d4',
  'panelTitle-activeBorder': '#0078d4',
  'panelTitle-activeForeground': '#e7e7e7',
  'panelTitle-inactiveForeground': '#9d9d9d',
  'inputValidation-warningBackground': '#352a05',
  'inputValidation-warningForeground': '#cccccc',
  'notificationsWarningIcon-foreground': '#cca700',
  'scrollbarSlider-background': '#79797966',
  'scrollbarSlider-hoverBackground': '#646464b3',
  'scrollbarSlider-activeBackground': '#bfbfbf66',
};

const LIGHT: Record<string, string> = {
  foreground: '#3b3b3b',
  descriptionForeground: '#3b3b3b99',
  errorForeground: '#e51400',
  focusBorder: '#005fb8',
  'editor-background': '#ffffff',
  'editorWidget-background': '#f8f8f8',
  'icon-foreground': '#3b3b3b',
  'panel-border': '#e5e5e5',
  'sideBar-background': '#f8f8f8',
  'sideBarSectionHeader-background': '#f8f8f8',
  'sideBarSectionHeader-foreground': '#3b3b3b',
  'list-hoverBackground': '#e8e8e8',
  'list-activeSelectionBackground': '#e4e6f1',
  'list-activeSelectionForeground': '#000000',
  'button-background': '#005fb8',
  'button-foreground': '#ffffff',
  'button-hoverBackground': '#0258a8',
  'extensionButton-prominentBackground': '#005fb8',
  'extensionButton-prominentForeground': '#ffffff',
  'extensionButton-prominentHoverBackground': '#0258a8',
  'extensionButton-background': '#e5e5e5',
  'extensionButton-foreground': '#3b3b3b',
  'extensionButton-hoverBackground': '#dcdcdc',
  'extensionBadge-remoteBackground': '#005fb8',
  'extensionBadge-remoteForeground': '#ffffff',
  'badge-background': '#cccccc',
  'badge-foreground': '#3b3b3b',
  'dropdown-background': '#ffffff',
  'dropdown-foreground': '#3b3b3b',
  'dropdown-border': '#cecece',
  'textLink-foreground': '#005fb8',
  'textLink-activeForeground': '#005fb8',
  'textCodeBlock-background': '#f3f3f3',
  'textBlockQuote-background': '#f8f8f8',
  'textBlockQuote-border': '#005fb8',
  'panelTitle-activeBorder': '#005fb8',
  'panelTitle-activeForeground': '#3b3b3b',
  'panelTitle-inactiveForeground': '#3b3b3b99',
  'inputValidation-warningBackground': '#fff8c5',
  'inputValidation-warningForeground': '#3b3b3b',
  'notificationsWarningIcon-foreground': '#bf8803',
  'scrollbarSlider-background': '#64646466',
  'scrollbarSlider-hoverBackground': '#646464b3',
  'scrollbarSlider-activeBackground': '#00000066',
};

const HC: Record<string, string> = {
  ...DARK,
  foreground: '#ffffff',
  descriptionForeground: '#ffffff',
  focusBorder: '#f38518',
  'editor-background': '#000000',
  'editorWidget-background': '#0c141f',
  'panel-border': '#6fc3df',
  'sideBar-background': '#000000',
  'sideBarSectionHeader-background': '#000000',
  'list-hoverBackground': '#000000',
  'list-activeSelectionBackground': '#000000',
  'list-activeSelectionForeground': '#ffffff',
  'extensionButton-prominentBackground': '#0078d4',
  'extensionButton-background': '#000000',
  'extensionButton-foreground': '#ffffff',
  'dropdown-background': '#000000',
  'dropdown-border': '#6fc3df',
  'textLink-foreground': '#3794ff',
  'inputValidation-warningBackground': '#000000',
  'inputValidation-warningForeground': '#ffffff',
};

const THEMES: Record<ThemeName, Record<string, string>> = {
  dark: DARK,
  light: LIGHT,
  hc: HC,
};

export function applyTheme(name: ThemeName): void {
  const style = document.documentElement.style;
  for (const [token, value] of Object.entries({ ...SHARED, ...THEMES[name] })) {
    style.setProperty(`--vscode-${token}`, value);
  }
  document.documentElement.dataset['pvmpTheme'] = name;
  document.body.style.backgroundColor = `var(--vscode-${name === 'light' ? 'sideBar' : 'sideBar'}-background)`;
}
