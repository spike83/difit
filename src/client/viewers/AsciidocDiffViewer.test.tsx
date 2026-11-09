import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DOMPurify from 'dompurify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { AsciidocDiffViewer, renderAsciidoc } from './AsciidocDiffViewer';
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // happy-dom's parser trips DOMPurify up, so only check that the HTML goes through it
  it('renders AsciiDoc through the sanitizer', async () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize').mockImplementation((html) => `clean:${html}`);

    const html = await renderAsciidoc('= Guide\n\n== Setup\n\nRun `make`.');

    expect(sanitize).toHaveBeenCalledOnce();
    expect(html).toMatch(/^clean:<h1>Guide<\/h1>/);
    expect(html).toContain('<h2 id="_setup">Setup</h2>');
    expect(html).toContain('<code>make</code>');
  });

  it('shows both versions side by side in the split preview', async () => {
    mockBlobs({ 'HEAD~1': '== Old heading', HEAD: '== New heading' });

    render(<AsciidocDiffViewer {...createProps()} markdownPreviewMode="split-preview" />);

    expect(await screen.findByRole('heading', { name: 'Old heading' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New heading' })).toBeInTheDocument();
    expect(screen.queryByTitle('Diff Preview')).not.toBeInTheDocument();
  });

  it('shows only the new version of an added file', async () => {
    mockBlobs({ HEAD: '== Added' });

    render(
      <AsciidocDiffViewer
        {...createProps({ status: 'added' })}
        markdownPreviewMode="split-preview"
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.queryByTitle('Split Preview')).not.toBeInTheDocument();
  });

  it('switches to the code diff', async () => {
    mockBlobs({ 'HEAD~1': '== Old', HEAD: '== New' });

    render(<AsciidocDiffViewer {...createProps()} markdownPreviewMode="full-preview" />);
    expect(await screen.findByRole('heading', { name: 'New' })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Code Diff'));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New' })).toBeNull());
  });
});
