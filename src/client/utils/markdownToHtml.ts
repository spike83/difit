import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { extractFrontmatter } from './frontmatter';
import { isSafeUrl } from './markdownUtils';

// Renders with react-markdown's default elements, so the HTML carries no app styling
// or review UI and pastes cleanly into documents and mail.
export function markdownToHtml(markdown: string): string {
  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkGfm], urlTransform: (url) => (isSafeUrl(url) ? url : '') },
        extractFrontmatter(markdown).content,
      ),
    );
  });
  const html = container.innerHTML;
  root.unmount();
  return html;
}
