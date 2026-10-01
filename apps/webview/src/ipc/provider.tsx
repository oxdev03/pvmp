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
 * One client per webview document, never disposed. StrictMode mounts twice in
 * development, and a dispose on unmount would leave the second mount with a
 * dead client.
 */
function getIpcClient(): Client {
  singleton ??= createIpcClient<HostApi, HostEvents>(createVsCodeTransport());
  return singleton;
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The host pushes catalogChanged, so focus refetches add nothing.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export interface HostProviderProps {
  children: ReactNode;
  /** For tests that bypass the bridge. */
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
