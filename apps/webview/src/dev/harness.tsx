/**
 * Dev and Playwright entry point. Never shipped to the extension.
 *
 * Installs the mock host before importing anything that touches
 * `acquireVsCodeApi`, then renders whichever view the query string asks for:
 *
 *   /?view=sidebar&fixture=auth
 *   /?view=details&ext=acme.lint&theme=light
 */
import { readExtensionId, ROOT_EXTENSION_ID_ATTRIBUTE } from '@pvmp/contract';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HostProvider } from '../ipc/provider.tsx';

import '../styles/main.css';
import { DetailsView } from '../views/DetailsView.tsx';
import { SidebarView } from '../views/SidebarView.tsx';
import type { ScenarioName } from './fixtures.ts';
import { installMockHost } from './mock-host.ts';
import type { ThemeName } from './themes.ts';
import { applyTheme } from './themes.ts';

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'sidebar';
const fixture = (params.get('fixture') ?? 'default') as ScenarioName;
const extensionId = params.get('ext') ?? 'acme.lint';
const theme = (params.get('theme') ?? 'dark') as ThemeName;

applyTheme(theme);
installMockHost(fixture);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

// Set the attribute the way the host does, so tests cover reading it.
// An empty `ext=` tests the no-target case.
if (extensionId) container.setAttribute(ROOT_EXTENSION_ID_ATTRIBUTE, extensionId);

createRoot(container).render(
  <StrictMode>
    <HostProvider>
      {view === 'details' ? (
        <DetailsView extensionId={readExtensionId(container)} />
      ) : (
        <SidebarView />
      )}
    </HostProvider>
  </StrictMode>,
);
