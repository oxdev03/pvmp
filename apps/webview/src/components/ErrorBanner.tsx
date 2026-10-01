import type { SourceError } from '@pvmp/contract';

import { ActionButton } from './ActionButton.tsx';

export interface ErrorBannerProps {
  error: SourceError;
  onSignIn: (sourceId: string) => void;
  onShowLog: () => void;
}

/** One banner per failing source (SPEC.md §7.4). Auth failures also offer sign-in. */
export function ErrorBanner({ error, onSignIn, onShowLog }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid={`source-error-${error.sourceId}`}
      className="border-vscode-panel-border bg-vscode-inputValidation-warningBackground text-vscode-inputValidation-warningForeground flex items-start gap-[8px] border-b px-[16px] py-[8px]"
    >
      <WarningGlyph />
      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        <div className="text-[12px] leading-[16px]">
          <span className="font-semibold">{error.sourceId}</span>
          {': '}
          {error.message}
        </div>
        <div className="flex gap-[6px]">
          {error.kind === 'auth' && (
            <ActionButton onClick={() => onSignIn(error.sourceId)}>Sign in</ActionButton>
          )}
          <ActionButton variant="secondary" onClick={onShowLog}>
            Show log
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function WarningGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
      className="mt-[1px] shrink-0"
    >
      <path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z" />
    </svg>
  );
}
