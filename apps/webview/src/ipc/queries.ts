import type { CatalogSnapshot, ExtensionDetails, InstallProgress } from '@pvmp/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useHost, useHostEvent } from './provider.tsx';

export const queryKeys = {
  catalog: ['catalog'] as const,
  details: (extensionId: string, version?: string) => ['details', extensionId, version] as const,
  icon: (extensionId: string, version: string) => ['icon', extensionId, version] as const,
};

export function useCatalog() {
  const host = useHost();
  return useQuery<CatalogSnapshot>({
    queryKey: queryKeys.catalog,
    queryFn: () => host.listCatalog(),
  });
}

export function useDetails(extensionId: string | undefined, version?: string) {
  const host = useHost();
  return useQuery<ExtensionDetails>({
    queryKey: queryKeys.details(extensionId ?? '', version),
    queryFn: () => host.getDetails(extensionId as string, version),
    // Empty as well as undefined: asking the host for extension "" only
    // produces a confusing "No such extension: " error.
    enabled: Boolean(extensionId),
  });
}

/**
 * Icons are fetched lazily, one row at a time, so the list does not pull
 * every tarball up front (SPEC.md §6.3). `enabled` is how a row defers until
 * it scrolls into view.
 */
export function useIcon(extensionId: string, version: string | undefined, enabled: boolean) {
  const host = useHost();
  return useQuery<string | undefined>({
    queryKey: queryKeys.icon(extensionId, version ?? ''),
    queryFn: () => host.getIcon(extensionId, version as string),
    enabled: enabled && version !== undefined,
    staleTime: Number.POSITIVE_INFINITY, // content-addressed; never goes stale
    retry: false,
  });
}

/** Invalidates the catalog whenever the host says it moved. */
export function useCatalogSync(): void {
  const queryClient = useQueryClient();
  useHostEvent(
    'catalogChanged',
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
    }, [queryClient]),
  );
}

/** Live install progress, keyed by extension id. */
export function useInstallProgress(): Map<string, InstallProgress> {
  const [progress, setProgress] = useState<Map<string, InstallProgress>>(new Map());

  useHostEvent(
    'installProgress',
    useCallback((event: InstallProgress) => {
      setProgress((previous) => {
        const next = new Map(previous);
        if (event.phase === 'done') next.delete(event.extensionId);
        else next.set(event.extensionId, event);
        return next;
      });
    }, []),
  );

  return progress;
}

export function useInstall() {
  const host = useHost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ extensionId, version }: { extensionId: string; version: string }) =>
      host.install(extensionId, version),
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useUninstall() {
  const host = useHost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (extensionId: string) => host.uninstall(extensionId),
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useRefresh() {
  const host = useHost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => host.refresh(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
  });
}

export function usePreReleaseOptIn() {
  const host = useHost();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ extensionId, on }: { extensionId: string; on: boolean }) =>
      host.setPreReleaseOptIn(extensionId, on),
    onSettled: () => queryClient.invalidateQueries(),
  });
}
