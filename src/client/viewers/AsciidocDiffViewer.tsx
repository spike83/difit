import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';

import { DEFAULT_PREVIEW_MODE, PreviewModeTabs, type PreviewMode } from './PreviewModeTabs';
import { TextDiffViewer } from './TextDiffViewer';
import type { DiffViewerBodyProps } from './types';

type Rendered = { base: string | null; target: string | null };

const fetchBlob = async (path: string, ref: string) => {
  const response = await fetch(
    `/api/blob/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!response.ok) throw new Error(`Failed to fetch preview: ${response.statusText}`);
  return response.text();
};

// Asciidoctor is large, so it loads with the first AsciiDoc preview. 'secure' blocks
// includes; DOMPurify drops what passthrough blocks could inject.
export const renderAsciidoc = async (source: string): Promise<string> => {
  const { convert } = await import('@asciidoctor/core');
  const html = await convert(source, { safe: 'secure', attributes: { showtitle: true } });
  return DOMPurify.sanitize(String(html));
};

const AsciidocPreview = ({ html, label }: { html: string; label?: string }) => (
  <div className="min-w-0 flex-1">
    {label && <div className="mb-3 text-xs font-mono text-github-text-muted truncate">{label}</div>}
    <div className="asciidoc-preview" dangerouslySetInnerHTML={{ __html: html }} />
  </div>
);

export function AsciidocDiffViewer(props: DiffViewerBodyProps) {
  const { file, baseCommitish, targetCommitish, diffVersion } = props;
  const { markdownPreviewMode, onMarkdownPreviewModeChange } = props;
  const [localMode, setLocalMode] = useState<PreviewMode>(
    markdownPreviewMode ?? DEFAULT_PREVIEW_MODE,
  );
  const mode = onMarkdownPreviewModeChange
    ? (markdownPreviewMode ?? DEFAULT_PREVIEW_MODE)
    : localMode;
  const handleModeChange = onMarkdownPreviewModeChange ?? setLocalMode;
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFetchable = (ref?: string): ref is string => Boolean(ref && ref !== 'stdin');
  const basePath =
    file.status === 'added' || !isFetchable(baseCommitish) ? null : (file.oldPath ?? file.path);
  const targetPath = file.status === 'deleted' || !isFetchable(targetCommitish) ? null : file.path;
  const hasPreview = basePath !== null || targetPath !== null;

  useEffect(() => {
    if (!hasPreview) return;
    let isCanceled = false;
    const load = (path: string | null, ref?: string) =>
      path && ref ? fetchBlob(path, ref).then(renderAsciidoc) : Promise.resolve(null);
    Promise.all([load(basePath, baseCommitish), load(targetPath, targetCommitish)])
      .then(([base, target]) => {
        if (isCanceled) return;
        setRendered({ base, target });
        setError(null);
      })
      .catch((err: unknown) => {
        if (isCanceled) return;
        setError(err instanceof Error ? err.message : 'Preview failed');
      });
    return () => {
      isCanceled = true;
    };
  }, [hasPreview, basePath, targetPath, baseCommitish, targetCommitish, diffVersion]);

  // Both sides are only worth showing next to each other when both exist; the
  // markdown-only "Diff Preview" falls back to the split view.
  const hasSplitPreview = basePath !== null && targetPath !== null;
  const effectiveMode: PreviewMode = !hasPreview
    ? 'diff'
    : mode === 'diff-preview' || (mode === 'split-preview' && !hasSplitPreview)
      ? hasSplitPreview
        ? 'split-preview'
        : 'full-preview'
      : mode;
  const fullHtml = file.status === 'deleted' ? rendered?.base : rendered?.target;

  return (
    <div className="bg-github-bg-primary">
      {hasPreview && (
        <div className="flex items-center border-b border-github-border px-4 py-2">
          <PreviewModeTabs
            mode={effectiveMode}
            hasFullPreview
            hasSplitPreview={hasSplitPreview}
            hasDiffPreview={false}
            onModeChange={handleModeChange}
          />
        </div>
      )}

      {effectiveMode === 'diff' && <TextDiffViewer {...props} />}

      {effectiveMode !== 'diff' && (
        <div className="p-4">
          {error && <div className="text-sm text-github-danger">{error}</div>}
          {!error && !rendered && (
            <div className="text-sm text-github-text-muted">Loading preview...</div>
          )}
          {!error && rendered && effectiveMode === 'split-preview' && (
            <div className="flex gap-6">
              <AsciidocPreview html={rendered.base ?? ''} label={baseCommitish} />
              <div className="w-px bg-github-border" />
              <AsciidocPreview html={rendered.target ?? ''} label={targetCommitish} />
            </div>
          )}
          {!error && rendered && effectiveMode === 'full-preview' && (
            <AsciidocPreview html={fullHtml ?? ''} />
          )}
        </div>
      )}
    </div>
  );
}
