import type { CatalogEntry, ExtensionLinks, ExtensionVersion } from '@pvmp/contract';
import { useState } from 'react';

import { ActionButton } from '../components/ActionButton.tsx';
import { ExtensionIcon } from '../components/ExtensionIcon.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useHost } from '../ipc/provider.tsx';
import {
  isBusy,
  useCatalogSync,
  useDetails,
  useInstall,
  useInstallProgress,
  usePreReleaseOptIn,
  useUninstall,
} from '../ipc/queries.ts';

const TABS = ['Details', 'Changelog'] as const;
type Tab = (typeof TABS)[number];

export interface DetailsViewProps {
  /** Undefined when the host did not stamp a target onto #root. */
  extensionId: string | undefined;
}

export function DetailsView({ extensionId }: DetailsViewProps) {
  const [selected, setSelected] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>('Details');
  const { data, isPending, error } = useDetails(extensionId, selected);
  const progress = useInstallProgress().get(extensionId ?? '');
  const install = useInstall();
  const uninstall = useUninstall();
  useCatalogSync();

  // With no target the query is disabled, so it would otherwise sit on
  // "Loading…" forever. This is the case the host used to hit silently.
  if (!extensionId) {
    return (
      <p
        data-testid="details-no-target"
        className="text-vscode-errorForeground p-[20px] text-[13px]"
      >
        This panel was opened without an extension to show.
      </p>
    );
  }

  if (isPending) {
    return <p className="text-vscode-descriptionForeground p-[20px] text-[13px]">Loading…</p>;
  }
  if (error || !data) {
    return (
      <p data-testid="details-error" className="text-vscode-errorForeground p-[20px] text-[13px]">
        Could not load {extensionId}: {error?.message ?? 'not found'}
      </p>
    );
  }

  const { entry, links } = data;
  const version = entry.versions.find((v) => v.version === data.selectedVersion);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Hero
        entry={entry}
        selectedVersion={data.selectedVersion}
        busy={isBusy(progress)}
        onSelectVersion={setSelected}
        onInstall={(v) => install.mutate({ extensionId, version: v })}
        onUninstall={() => uninstall.mutate(extensionId)}
      />

      <div className="flex min-h-0 flex-1 gap-[24px] px-[20px] pb-[24px]">
        <div className="min-w-0 flex-1">
          <div
            role="tablist"
            className="border-vscode-panel-border mb-[16px] flex gap-[16px] border-b"
          >
            {TABS.map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={`-mb-px cursor-pointer border-0 border-b-[1px] bg-transparent px-[2px] pb-[6px] text-[13px] tracking-wide uppercase ${
                  tab === name
                    ? 'border-b-vscode-panelTitle-activeBorder text-vscode-panelTitle-activeForeground'
                    : 'text-vscode-panelTitle-inactiveForeground border-b-transparent'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <div role="tabpanel" data-testid={`tab-${tab.toLowerCase()}`}>
            {tab === 'Details' ? (
              <Markdown source={data.readme} empty="This extension has no README." />
            ) : (
              <Markdown source={data.changelog} empty="This extension has no changelog." />
            )}
          </div>
        </div>

        <aside className="border-vscode-panel-border w-[220px] shrink-0 border-l pl-[20px]">
          <Categories categories={entry.categories} />
          <Resources links={links} />
          <MoreInfo entry={entry} version={version} />
        </aside>
      </div>
    </div>
  );
}

interface HeroProps {
  entry: CatalogEntry;
  selectedVersion: string;
  busy: boolean;
  onSelectVersion: (version: string) => void;
  onInstall: (version: string) => void;
  onUninstall: () => void;
}

function Hero({
  entry,
  selectedVersion,
  busy,
  onSelectVersion,
  onInstall,
  onUninstall,
}: HeroProps) {
  const host = useHost();
  const preRelease = usePreReleaseOptIn();
  const installed = entry.installed;
  const isSelectedInstalled = installed?.version === selectedVersion;

  return (
    <header className="border-vscode-panel-border flex gap-[20px] border-b p-[20px]">
      <ExtensionIcon extensionId={entry.extensionId} version={entry.latest?.version} size={128} />

      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        <div className="flex items-center gap-[10px]">
          <h1 className="m-0 truncate text-[26px] leading-[32px] font-semibold">
            {entry.displayName}
          </h1>
          <select
            aria-label="Version"
            data-testid="version-select"
            value={selectedVersion}
            onChange={(event) => onSelectVersion(event.target.value)}
            className="border-vscode-dropdown-border bg-vscode-dropdown-background text-vscode-dropdown-foreground h-[22px] rounded-[2px] border px-[4px] text-[12px]"
          >
            {entry.versions.map((v) => (
              <option key={`${v.sourceId}-${v.version}`} value={v.version}>
                v{v.version}
                {v.shadowed ? ' (shadowed)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="text-vscode-descriptionForeground flex items-center gap-[8px] text-[13px]">
          <span>{entry.publisherDisplayName}</span>
          <span aria-hidden="true">|</span>
          <span>{entry.extensionId}</span>
        </div>

        <p className="m-0 text-[14px] leading-[20px]">{entry.description}</p>

        <div className="mt-[6px] flex items-center gap-[8px]">
          {busy ? (
            <span
              data-testid="details-progress"
              className="text-vscode-descriptionForeground text-[12px]"
            >
              Working…
            </span>
          ) : (
            <>
              <ActionButton
                className="h-[26px] px-[12px] text-[13px]"
                disabled={isSelectedInstalled}
                onClick={() => onInstall(selectedVersion)}
              >
                {!installed
                  ? 'Install'
                  : isSelectedInstalled
                    ? 'Installed'
                    : `Install v${selectedVersion}`}
              </ActionButton>
              {installed && (
                <ActionButton
                  variant="secondary"
                  className="h-[26px] px-[12px] text-[13px]"
                  onClick={onUninstall}
                >
                  Uninstall
                </ActionButton>
              )}
            </>
          )}

          <label className="text-vscode-descriptionForeground ml-[4px] flex cursor-pointer items-center gap-[5px] text-[12px]">
            <input
              type="checkbox"
              checked={entry.preReleaseOptIn}
              onChange={(event) =>
                preRelease.mutate({ extensionId: entry.extensionId, on: event.target.checked })
              }
            />
            Include pre-releases
          </label>

          <button
            type="button"
            onClick={() => void host.openLog()}
            className="text-vscode-textLink-foreground ml-auto cursor-pointer border-0 bg-transparent text-[12px] hover:underline"
          >
            Show log
          </button>
        </div>

        {installed?.external && (
          <p
            data-testid="external-warning"
            className="text-vscode-notificationsWarningIcon-foreground m-0 text-[12px]"
          >
            v{installed.version} is installed but is not offered by any configured source.
          </p>
        )}
      </div>
    </header>
  );
}

function SidebarHeading({ children }: { children: string }) {
  return <h3 className="mt-[18px] mb-[8px] text-[13px] font-semibold first:mt-0">{children}</h3>;
}

function Categories({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;
  return (
    <>
      <SidebarHeading>Categories</SidebarHeading>
      <div className="flex flex-wrap gap-[4px]">
        {categories.map((category) => (
          <span
            key={category}
            className="bg-vscode-badge-background text-vscode-badge-foreground rounded-[2px] px-[6px] py-[1px] text-[11px]"
          >
            {category}
          </span>
        ))}
      </div>
    </>
  );
}

function Resources({ links }: { links: ExtensionLinks }) {
  const candidates: [string, string | undefined][] = [
    ['Repository', links.repository],
    ['Homepage', links.homepage],
    ['Issues', links.bugs],
  ];
  const entries = candidates.filter((pair): pair is [string, string] => pair[1] !== undefined);

  if (entries.length === 0) return null;
  return (
    <>
      <SidebarHeading>Resources</SidebarHeading>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {entries.map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-vscode-textLink-foreground text-[12px] hover:underline"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function MoreInfo({
  entry,
  version,
}: {
  entry: CatalogEntry;
  version: ExtensionVersion | undefined;
}) {
  const rows: [string, string][] = [
    ['Identifier', entry.extensionId],
    ['Installed', entry.installed ? `v${entry.installed.version}` : 'None'],
    ['Platform', version?.targetPlatform ?? '—'],
    ['Requires', version?.engine ?? '—'],
    ['Source', version?.sourceId ?? '—'],
    ['Published', version?.publishedAt ? new Date(version.publishedAt).toLocaleDateString() : '—'],
  ];

  return (
    <>
      <SidebarHeading>More Info</SidebarHeading>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-[10px] gap-y-[3px] text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-vscode-descriptionForeground">{label}</dt>
            <dd className="m-0 truncate" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
