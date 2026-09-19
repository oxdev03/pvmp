/*
 * role="listbox" is correct for a custom list of extensions;
 * prefer-tag-over-role suggests <select>/<datalist>, which are form controls.
 */
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

export interface SectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A collapsible group header, styled like VS Code's side bar section headers. */
export function Section({ title, count, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <section data-testid={`section-${title.toLowerCase().replaceAll(' ', '-')}`}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          className="bg-vscode-sideBarSectionHeader-background text-vscode-sideBarSectionHeader-foreground sticky top-0 z-10 flex h-[22px] w-full cursor-pointer items-center gap-[3px] border-0 px-[8px] text-[11px] font-bold tracking-wide uppercase"
        >
          <Chevron open={open} />
          <span className="truncate">{title}</span>
          <span className="ml-[4px] font-normal tabular-nums opacity-70">({count})</span>
        </button>
      </h2>
      <div id={regionId} hidden={!open} role="listbox" aria-label={title}>
        {children}
      </div>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
    >
      <path d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z" />
    </svg>
  );
}
