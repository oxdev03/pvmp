import type { CatalogEntry } from '@pvmp/contract';
import { useMemo } from 'react';

import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { ExtensionRow } from '../components/ExtensionRow.tsx';
import { Section } from '../components/Section.tsx';
import { useHost } from '../ipc/provider.tsx';
import {
  useCatalog,
  useCatalogSync,
  useInstall,
  useInstallProgress,
  useUninstall,
} from '../ipc/queries.ts';

interface Groups {
  updates: CatalogEntry[];
  installed: CatalogEntry[];
  available: CatalogEntry[];
}

function group(entries: readonly CatalogEntry[]): Groups {
  const groups: Groups = { updates: [], installed: [], available: [] };
  for (const entry of entries) {
    if (entry.status === 'update-available') groups.updates.push(entry);
    else if (entry.status === 'installed') groups.installed.push(entry);
    else groups.available.push(entry);
  }
  return groups;
}

export function SidebarView() {
  const host = useHost();
  const { data, isPending, error } = useCatalog();
  const progress = useInstallProgress();
  const install = useInstall();
  const uninstall = useUninstall();
  useCatalogSync();

  const groups = useMemo(() => group(data?.entries ?? []), [data?.entries]);

  const onInstall = (entry: CatalogEntry) => {
    if (entry.latest) {
      install.mutate({ extensionId: entry.extensionId, version: entry.latest.version });
    }
  };

  const renderRows = (entries: CatalogEntry[]) =>
    entries.map((entry) => {
      const active = progress.get(entry.extensionId);
      return (
        <ExtensionRow
          key={entry.extensionId}
          entry={entry}
          {...(active ? { progress: active } : {})}
          onOpen={(id) => void host.openExtension(id)}
          onInstall={onInstall}
          onUninstall={(e) => uninstall.mutate(e.extensionId)}
        />
      );
    });

  if (isPending) {
    return (
      <p
        data-testid="loading"
        className="text-vscode-descriptionForeground px-[16px] py-[12px] text-[12px]"
      >
        Loading extensions…
      </p>
    );
  }

  if (error) {
    return (
      <div data-testid="catalog-error" className="flex flex-col gap-[8px] px-[16px] py-[12px]">
        <p className="text-vscode-errorForeground m-0 text-[12px]">
          Could not load the marketplace: {error.message}
        </p>
      </div>
    );
  }

  const total = data ? data.entries.length : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {data?.errors.map((sourceError) => (
        <ErrorBanner
          key={sourceError.sourceId}
          error={sourceError}
          onSignIn={(sourceId) => void host.signIn(sourceId)}
          onShowLog={() => void host.openLog()}
        />
      ))}

      {total === 0 ? (
        <EmptyState onAddSource={() => void host.addLocalSource()} />
      ) : (
        (
          [
            ['Updates Available', groups.updates],
            ['Installed', groups.installed],
            ['Available', groups.available],
          ] as const
        ).map(
          ([title, entries]) =>
            entries.length > 0 && (
              <Section key={title} title={title} count={entries.length}>
                {renderRows(entries)}
              </Section>
            ),
        )
      )}
    </div>
  );
}

function EmptyState({ onAddSource }: { onAddSource: () => void }) {
  return (
    <div data-testid="empty-state" className="flex flex-col gap-[10px] px-[16px] py-[14px]">
      <p className="m-0 text-[13px] leading-[19px]">No extensions found.</p>
      <p className="text-vscode-descriptionForeground m-0 text-[13px] leading-[19px]">
        Add a folder of <code>.tgz</code> packages, or configure a registry in settings.
      </p>
      <button
        type="button"
        onClick={onAddSource}
        className="bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground cursor-pointer self-start rounded-[2px] border-0 px-[14px] py-[4px] text-[13px]"
      >
        Add Folder Source
      </button>
    </div>
  );
}
