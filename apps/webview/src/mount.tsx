import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/main.css';
import { HostProvider } from './ipc/provider.tsx';

export function mount(render: (root: HTMLElement) => ReactNode): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root is missing from the webview document');
  createRoot(root).render(
    <StrictMode>
      <HostProvider>{render(root)}</HostProvider>
    </StrictMode>,
  );
}
