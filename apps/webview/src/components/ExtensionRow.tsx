/*
 * role="option" inside the section's role="listbox" is the correct pattern for
 * a custom list. prefer-tag-over-role wants a literal <option>, which is only
 * valid inside <select>.
 */
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import type { CatalogEntry, InstallProgress } from '@pvmp/contract';
import type { MouseEvent } from 'react';

import { isBusy } from '../ipc/queries.ts';
import { ActionButton } from './ActionButton.tsx';
import { ExtensionIcon } from './ExtensionIcon.tsx';
import { METRICS } from './metrics.ts';

export interface ExtensionRowProps {
  entry: CatalogEntry;
  progress?: InstallProgress;
  selected?: boolean;
  onOpen: (extensionId: string) => void;
  onInstall: (entry: CatalogEntry) => void;
  onUninstall: (entry: CatalogEntry) => void;
}

const PHASE_LABEL: Record<InstallProgress['phase'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  extracting: 'Extracting',
  installing: 'Installing',
  done: 'Done',
  failed: 'Failed',
};

export function ExtensionRow({
  entry,
  progress,
  selected = false,
  onOpen,
  onInstall,
  onUninstall,
}: ExtensionRowProps) {
  const version = entry.installed?.version ?? entry.latest?.version;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-testid={`row-${entry.extensionId}`}
      onClick={() => onOpen(entry.extensionId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(entry.extensionId);
        }
      }}
      className={`group box-border flex w-full cursor-pointer items-center gap-[14px] overflow-hidden pr-[12px] ${
        selected
          ? 'bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground'
          : 'hover:bg-vscode-list-hoverBackground'
      }`}
      style={{ height: METRICS.rowHeight, paddingLeft: METRICS.rowPaddingLeft }}
    >
      <ExtensionIcon extensionId={entry.extensionId} version={entry.latest?.version} />

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div
          className="flex items-center gap-[6px] overflow-hidden"
          style={{ height: METRICS.headerHeight }}
        >
          <span
            className="truncate text-[13px]"
            style={{ fontWeight: METRICS.semiBold }}
            title={entry.displayName}
          >
            {entry.displayName}
          </span>
          {version && (
            <span className="text-vscode-descriptionForeground shrink-0 text-[11px] tabular-nums">
              v{version}
            </span>
          )}
          {entry.installed?.external && (
            <span
              title="Installed from outside this marketplace"
              className="bg-vscode-extensionBadge-remoteBackground text-vscode-extensionBadge-remoteForeground shrink-0 rounded-[2px] px-[4px] text-[9px] tracking-wide uppercase"
            >
              external
            </span>
          )}
        </div>

        <div className="text-vscode-descriptionForeground truncate pr-[8px] text-[12px] leading-normal">
          {entry.description}
        </div>

        <div
          className="flex items-center justify-between gap-[8px] overflow-hidden pt-[2px] pr-[2px]"
          style={{ height: METRICS.footerHeight }}
        >
          <span
            className="text-vscode-descriptionForeground truncate text-[11px]"
            style={{ fontWeight: METRICS.semiBold }}
          >
            {entry.publisherDisplayName}
          </span>
          <div className="shrink-0">
            {isBusy(progress) ? (
              <span
                data-testid={`progress-${entry.extensionId}`}
                className="text-vscode-descriptionForeground text-[11px]"
              >
                {PHASE_LABEL[progress.phase]}…
              </span>
            ) : (
              <RowAction entry={entry} onInstall={onInstall} onUninstall={onUninstall} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Buttons sit inside the row, which opens the details panel on click, so they
 * stop propagation themselves. Doing it on a wrapper div would put a click
 * handler on a non-interactive element.
 */
const act = (run: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  run();
};

function RowAction({
  entry,
  onInstall,
  onUninstall,
}: Pick<ExtensionRowProps, 'entry' | 'onInstall' | 'onUninstall'>) {
  if (entry.status === 'update-available' && entry.latest) {
    return <ActionButton onClick={act(() => onInstall(entry))}>Update</ActionButton>;
  }
  if (entry.status === 'available') {
    return (
      <ActionButton onClick={act(() => onInstall(entry))} disabled={!entry.latest}>
        Install
      </ActionButton>
    );
  }
  // Installed and current. VS Code hides management behind hover here too.
  return (
    <ActionButton
      variant="secondary"
      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={act(() => onUninstall(entry))}
    >
      Uninstall
    </ActionButton>
  );
}
