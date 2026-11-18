import { describe, expect, it } from 'vitest';

import type { DiffFile } from '../types/diff';

import { describeViewedFileChange, snapshotChangeLines } from './viewedFileChanges';

const file = (lines: DiffFile['chunks'][number]['lines']): DiffFile => ({
  path: 'a.ts',
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks: [{ header: '@@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
});

describe('viewedFileChanges', () => {
  const viewed = file([
    { type: 'delete', content: 'old', oldLineNumber: 1 },
    { type: 'add', content: 'one', newLineNumber: 1 },
  ]);

  it('lists the lines added to the diff since the snapshot, and those gone from it', () => {
    const now = file([
      { type: 'add', content: 'one', newLineNumber: 1 },
      { type: 'add', content: 'two', newLineNumber: 2 },
      { type: 'add', content: 'three', newLineNumber: 3 },
    ]);

    const body = describeViewedFileChange(now, snapshotChangeLines(viewed));

    expect(body).toContain('unviewed again');
    expect(body).toContain('New in the diff: 2 added lines, 0 removed lines (L2-L3).');
    expect(body).toContain('No longer in the diff: 1 line');
    expect(body).toContain('```diff\n+two\n+three\n```');
  });

  it('says when only the surrounding lines moved, and when there is no snapshot', () => {
    expect(describeViewedFileChange(viewed, snapshotChangeLines(viewed))).toContain(
      'Only the unchanged lines',
    );
    expect(describeViewedFileChange(viewed, undefined)).toContain('no snapshot');
  });
});
