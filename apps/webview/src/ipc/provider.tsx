import type { HostApi, HostEvents, IpcClient } from '@pvmp/contract';
import { createIpcClient } from '@pvmp/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createContext, use, useEffect, useMemo } from 'react';

import { createVsCodeTransport } from './bridge.ts';

type Client = IpcClient<HostApi, HostEvents>;

const HostContext = createContext<Client | undefined>(undefined);

let singleton: Client | undefined;

/**
 * One client per webview document, for the life of the document.
 *
 * Not owned by the provider: StrictMode mounts twice in development, so an
 * unmount-time dispose would tear down the channel and leave the second mount
 * talking to a dead client. There is exactly one `acquireVsCodeApi` channel
 * anyway, and the webview's own teardown ends it.
 */
function getIpcClient(): Client {
  singleton ??= createIpcClient<HostApi, HostEvents>(createVsCodeTransport());
  return singleton;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The host is local and pushes catalogChanged when data moves, so
        // window-focus refetching would only add noise.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export interface HostProviderProps {
  children: ReactNode;
  /** Injected by tests that bypass the bridge; production builds its own. */
  client?: Client;
  queryClient?: QueryClient;
}

export function HostProvider({ children, client, queryClient }: HostProviderProps) {
  const resolved = client ?? getIpcClient();
  const queries = useMemo(() => queryClient ?? createQueryClient(), [queryClient]);

  return (
    <HostContext value={resolved}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </HostContext>
  );
}

export function useHostClient(): Client {
  const client = use(HostContext);
  if (!client) throw new Error('useHostClient must be used inside a HostProvider');
  return client;
}

export function useHost(): HostApi {
  return useHostClient().api;
}

/** Subscribes to a host event for the lifetime of the component. */
export function useHostEvent<K extends keyof HostEvents & string>(
  event: K,
  listener: HostEvents[K],
): void {
  const client = useHostClient();
  useEffect(() => client.on(event, listener), [client, event, listener]);
}
