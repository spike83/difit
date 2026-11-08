import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { DiffFile } from '../../types/diff';

import { DiffViewerHeader } from './DiffViewerHeader';

const file: DiffFile = {
  path: 'src/app.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  chunks: [],
};

const baseProps = {
  file,
  isCollapsed: false,
  isReviewed: false,
  onToggleCollapsed: vi.fn(),
  onToggleAllCollapsed: vi.fn(),
  onToggleReviewed: vi.fn(),
};

describe('DiffViewerHeader', () => {
  it('shows the "Updated" badge when the file changed since last viewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed />);

    const badge = screen.getByLabelText('Updated since you last viewed this file');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Updated');
    expect(badge).toHaveAttribute('title', 'Updated since you last viewed this file');
  });

  it('warns about CRLF and mixed line endings', () => {
    const { rerender } = render(<DiffViewerHeader {...baseProps} />);
    expect(screen.queryByText('CRLF')).not.toBeInTheDocument();

    rerender(<DiffViewerHeader {...baseProps} file={{ ...file, lineEndings: 'crlf' }} />);
    expect(screen.getByText('CRLF')).toBeInTheDocument();

    rerender(<DiffViewerHeader {...baseProps} file={{ ...file, lineEndings: 'mixed' }} />);
    expect(screen.getByText('Mixed line endings')).toBeInTheDocument();
  });

  it('hides the "Updated" badge once the file is marked as reviewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed isReviewed />);

    expect(
      screen.queryByLabelText('Updated since you last viewed this file'),
    ).not.toBeInTheDocument();
  });

  it('hides the "Updated" badge when the file is unchanged since last viewed', () => {
    render(<DiffViewerHeader {...baseProps} isChangedSinceViewed={false} />);

    expect(
      screen.queryByLabelText('Updated since you last viewed this file'),
    ).not.toBeInTheDocument();
  });

  it('copies the full file content fetched from the blob endpoint', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fetchMock = vi.fn().mockResolvedValue(new Response('line 1\nline 2\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DiffViewerHeader {...baseProps} contentSource={{ path: 'src/app.ts', ref: 'working' }} />,
    );
    fireEvent.click(screen.getByLabelText('Copy file content'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('line 1\nline 2\n'));
    expect(fetchMock).toHaveBeenCalledWith('/api/blob/src%2Fapp.ts?ref=working');
    vi.unstubAllGlobals();
  });

  it('hides the file content copy button without a content source', () => {
    render(<DiffViewerHeader {...baseProps} contentSource={null} />);

    expect(screen.queryByLabelText('Copy file content')).not.toBeInTheDocument();
  });

  it('offers "Expand all lines" while lines are hidden', () => {
    const onToggle = vi.fn();
    render(<DiffViewerHeader {...baseProps} fullFileToggle={{ expanded: false, onToggle }} />);

    fireEvent.click(screen.getByLabelText('Expand all lines'));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('offers "Collapse expanded lines" once the whole file is shown', () => {
    render(
      <DiffViewerHeader {...baseProps} fullFileToggle={{ expanded: true, onToggle: vi.fn() }} />,
    );

    expect(screen.getByLabelText('Collapse expanded lines')).toBeInTheDocument();
  });

  it('shows no full-file toggle without one', () => {
    render(<DiffViewerHeader {...baseProps} />);

    expect(screen.queryByLabelText('Expand all lines')).not.toBeInTheDocument();
  });

  it('offers a jump to the top only for a file taller than the window', () => {
    const renderIn = (height: number) => {
      const section = document.createElement('div');
      section.dataset.filePath = file.path;
      Object.defineProperty(section, 'offsetHeight', { value: height });
      section.scrollIntoView = vi.fn();
      document.body.appendChild(section);
      const view = render(<DiffViewerHeader {...baseProps} />, { container: section });
      return { section, view };
    };

    const short = renderIn(window.innerHeight - 1);
    expect(screen.queryByLabelText('Scroll to top of file')).not.toBeInTheDocument();
    short.view.unmount();

    const long = renderIn(window.innerHeight * 3);
    fireEvent.click(screen.getByLabelText('Scroll to top of file'));
    expect(long.section.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });
});
