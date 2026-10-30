import { describe, expect, it } from 'vitest';

import type { DiffLine } from '../../types/diff';

import { getChunkCopyText } from './chunkCopyText';

const line = (type: DiffLine['type'], content: string): DiffLine => ({ type, content });

describe('getChunkCopyText', () => {
  it('copies the hunk as it reads after the change', () => {
    const lines = [
      line('normal', 'const a = 1;'),
      line('delete', 'const b = 2;'),
      line('add', 'const b = 3;'),
      line('normal', 'export { a, b };'),
    ];

    expect(getChunkCopyText({ lines })).toBe('const a = 1;\nconst b = 3;\nexport { a, b };');
  });

  it('copies the removed lines when the hunk only deletes', () => {
    const lines = [line('normal', 'keep();'), line('delete', 'drop();')];

    expect(getChunkCopyText({ lines })).toBe('keep();\ndrop();');
  });

  it('skips hunk and header lines', () => {
    const lines = [line('hunk', '@@ -1 +1 @@'), line('add', 'added();')];

    expect(getChunkCopyText({ lines })).toBe('added();');
  });
});
