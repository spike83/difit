import { useEffect, useState } from 'react';

import type { MarkdownBlock } from '../utils/markdownBlocks';
import { prepareAsciidocSide, type AsciidocSource, type PreparedBlocks } from '../utils/asciidoc';

import { MarkdownSplitPreview, type MarkdownSplitPreviewProps } from './MarkdownSplitPreview';

export type AsciidocSources = { base: AsciidocSource; target: AsciidocSource };

/** The markdown previews, fed with AsciiDoc blocks that Asciidoctor rendered one by one. */
export function AsciidocSplitPreview({
  sources,
  ...props
}: MarkdownSplitPreviewProps & { sources: AsciidocSources }) {
  const { baseContent, targetContent } = props;
  const [prepared, setPrepared] = useState<PreparedBlocks | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCanceled = false;
    const html = new Map<MarkdownBlock, string>();
    Promise.all([
      prepareAsciidocSide(baseContent, sources.base, html),
      prepareAsciidocSide(targetContent, sources.target, html),
    ])
      .then(([oldBlocks, newBlocks]) => {
        if (isCanceled) return;
        setPrepared({ old: oldBlocks, new: newBlocks, html });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isCanceled) setError(err instanceof Error ? err.message : 'Preview failed');
      });
    return () => {
      isCanceled = true;
    };
  }, [baseContent, targetContent, sources.base, sources.target]);

  if (error) return <div className="p-4 text-sm text-github-danger">{error}</div>;
  if (!prepared)
    return <div className="p-4 text-sm text-github-text-muted">Loading preview...</div>;
  return <MarkdownSplitPreview {...props} blocks={prepared} />;
}
