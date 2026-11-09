import { render, screen } from '@testing-library/react';
import DOMPurify from 'dompurify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { AsciidocDiffViewer } from './AsciidocDiffViewer';
import type { DiffViewerBodyProps } from './types';

const createProps = (file: Partial<DiffFile> = {}): DiffViewerBodyProps => ({
  file: {
    path: 'docs/guide.adoc',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks: [],
    ...file,
  },
  threads: [],
  diffMode: 'unified',
  mergedChunks: [],
  isExpandLoading: false,
  expandHiddenLines: vi.fn().mockResolvedValue(undefined),
  expandAllBetweenChunks: vi.fn().mockResolvedValue(undefined),
  onAddComment: vi.fn().mockResolvedValue(undefined),
  onGenerateThreadPrompt: vi.fn(),
  onRemoveThread: vi.fn(),
  onReplyToThread: vi.fn().mockResolvedValue(undefined),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
  baseCommitish: 'HEAD~1',
  targetCommitish: 'HEAD',
});

const mockBlobs = (blobs: Record<string, string>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const ref = new URL(String(input), 'http://localhost').searchParams.get('ref') ?? '';
    return new Response(blobs[ref] ?? '', { status: ref in blobs ? 200 : 404 });
  });

describe('AsciidocDiffViewer', () => {
  beforeEach(() => {
    // happy-dom's parser trips DOMPurify up; sanitizing is covered in asciidoc.test.ts
    vi.spyOn(DOMPurify, 'sanitize').mockImplementation((html) => String(html));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the same tabs as markdown', async () => {
    mockBlobs({ 'HEAD~1': '== Title\n\nOld text.', HEAD: '== Title\n\nNew text.' });

    render(<AsciidocDiffViewer {...createProps()} markdownPreviewMode="split-preview" />);

    expect(await screen.findByTitle('Split Preview')).toBeInTheDocument();
    expect(screen.getByTitle('Diff Preview')).toBeInTheDocument();
    expect(screen.getByTitle('Full Preview')).toBeInTheDocument();
  });

  it('aligns changed blocks side by side in the split preview', async () => {
    mockBlobs({ 'HEAD~1': '== Title\n\nOld text.', HEAD: '== Title\n\nNew text.' });

    const { container } = render(
      <AsciidocDiffViewer {...createProps()} markdownPreviewMode="split-preview" />,
    );

    expect(await screen.findByText('Old text.')).toBeInTheDocument();
    expect(screen.getByText('New text.')).toBeInTheDocument();
    expect(container.querySelector('[data-md-row-type="modified"]')).not.toBeNull();
  });
});
