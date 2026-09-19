import { useEffect, useRef, useState } from 'react';

import { useIcon } from '../ipc/queries.ts';
import { METRICS } from './metrics.ts';

export interface ExtensionIconProps {
  extensionId: string;
  version: string | undefined;
  size?: number;
}

/**
 * Loads the icon only once the row is on screen.
 *
 * Icons live inside the package tarball, so each one is a network fetch the
 * host streams and aborts early (SPEC.md §6.3). Fetching them for a whole
 * catalog up front would be the expensive mistake this defers.
 */
export function ExtensionIcon({
  extensionId,
  version,
  size = METRICS.iconSize,
}: ExtensionIconProps) {
  const ref = useRef<HTMLDivElement>(null);
  // jsdom and very old webviews have no IntersectionObserver; there, start
  // visible rather than setting state from inside the effect.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  const { data: source } = useIcon(extensionId, version, visible);

  return (
    <div
      ref={ref}
      data-testid={`icon-${extensionId}`}
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {source ? (
        <img src={source} alt="" width={size} height={size} className="object-contain" />
      ) : (
        <div
          aria-hidden="true"
          className="bg-vscode-editorWidget-background text-vscode-icon-foreground flex size-full items-center justify-center rounded-[3px] opacity-60"
          style={{ fontSize: size * 0.55 }}
        >
          <ExtensionGlyph />
        </div>
      )}
    </div>
  );
}

/** The codicon `extensions` glyph, inlined so no icon font is bundled. */
function ExtensionGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M13.5 2h-3l-.5.5v3l.5.5h3l.5-.5v-3L13.5 2zM13 5h-2V3h2v2zM5.5 2h-3l-.5.5v3l.5.5h3l.5-.5v-3L5.5 2zM5 5H3V3h2v2zm.5 4.5h-3l-.5.5v3l.5.5h3l.5-.5v-3l-.5-.5zM5 13H3v-2h2v2zm8.5-3.5h-3l-.5.5v3l.5.5h3l.5-.5v-3l-.5-.5zM13 13h-2v-2h2v2z" />
    </svg>
  );
}
