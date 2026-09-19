import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/*
 * Defined once at module scope, not inside render: react-markdown treats a new
 * `components` object as new component types and remounts the entire rendered
 * tree on every render.
 *
 * The heading overrides shift everything down a level so the page title stays
 * the only <h1>. Their content arrives through the props spread, which the
 * heading-has-content rule cannot see.
 */
/* oxlint-disable jsx-a11y/heading-has-content, jsx-a11y/anchor-has-content */
const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    // Webview links must not navigate the frame itself.
    <a {...props} target="_blank" rel="noreferrer noopener" />
  ),
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  h5: ({ node: _node, ...props }) => <h6 {...props} />,
  h6: ({ node: _node, ...props }) => <h6 {...props} />,
};
/* oxlint-enable jsx-a11y/heading-has-content, jsx-a11y/anchor-has-content */

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

export interface MarkdownProps {
  source: string | undefined;
  empty: string;
}

/**
 * Renders README/CHANGELOG markdown published by whoever owns the package.
 *
 * Sanitized here rather than trusted: the webview runs with scripts enabled,
 * and this content crosses a trust boundary (SPEC.md §7.7). rehype-sanitize's
 * default schema drops scripts, event handlers and javascript: URLs; the CSP
 * the host sets is the second layer.
 */
export function Markdown({ source, empty }: MarkdownProps) {
  if (!source?.trim()) {
    return <p className="text-vscode-descriptionForeground m-0 text-[13px]">{empty}</p>;
  }

  return (
    <div className="pvmp-markdown text-[14px] leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
