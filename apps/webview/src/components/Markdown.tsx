import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/*
 * Module scope: react-markdown treats a new `components` object as new
 * component types and remounts the whole tree.
 *
 * Headings shift down a level so the page title stays the only <h1>. Their
 * content comes through the props spread, which the lint rule cannot see.
 */
/* oxlint-disable jsx-a11y/heading-has-content, jsx-a11y/anchor-has-content */
const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    // A link must not navigate the webview frame.
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
 * Renders a package's README or CHANGELOG. Any publisher can write these, and
 * the webview runs scripts, so rehype-sanitize drops scripts, event handlers
 * and javascript: URLs. The host's CSP is the second layer (SPEC.md §7.7).
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
