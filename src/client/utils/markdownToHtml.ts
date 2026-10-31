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

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });

// Pasted HTML can't reach difit's server, so images served by it travel as data URLs.
export async function inlineImages(html: string): Promise<string> {
  const template = document.createElement('template');
  template.innerHTML = html;
  await Promise.all(
    Array.from(template.content.querySelectorAll('img')).map(async (img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return;
      try {
        const response = await fetch(url);
        if (response.ok) img.setAttribute('src', await blobToDataUrl(await response.blob()));
      } catch {
        // keep the original src
      }
    }),
  );
  return template.innerHTML;
}
