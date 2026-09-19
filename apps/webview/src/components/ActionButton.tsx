import type { ButtonHTMLAttributes } from 'react';

type Variant = 'prominent' | 'secondary';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * Matches VS Code's extension action button, which uses the
 * `extensionButton.prominent*` colours rather than the generic button ones.
 */
export function ActionButton({
  variant = 'prominent',
  className = '',
  ...rest
}: ActionButtonProps) {
  const palette =
    variant === 'prominent'
      ? 'bg-vscode-extensionButton-prominentBackground text-vscode-extensionButton-prominentForeground hover:bg-vscode-extensionButton-prominentHoverBackground'
      : 'bg-vscode-extensionButton-background text-vscode-extensionButton-foreground hover:bg-vscode-extensionButton-hoverBackground';

  return (
    <button
      type="button"
      className={`inline-flex h-[20px] cursor-pointer items-center justify-center rounded-[2px] border-0 px-[8px] text-[11px] leading-none whitespace-nowrap disabled:cursor-default disabled:opacity-50 ${palette} ${className}`}
      {...rest}
    />
  );
}
