import { describe, expect, it } from 'vitest';

import type { DiffLine } from '../../types/diff';

import { getChunkCopyText } from './chunkCopyText';

const line = (type: DiffLine['type'], content: string): DiffLine => ({ type, content });

describe('getChunkCopyText', () => {
  it('copies only the added lines', () => {
    const lines = [
      line('normal', 'const a = 1;'),
      line('delete', 'const b = 2;'),
      line('add', 'const b = 3;'),
      line('normal', 'const c = 4;'),
      line('add', 'export { a, b, c };'),
    ];

    expect(getChunkCopyText({ lines })).toBe('const b = 3;\nexport { a, b, c };');
  });

  it('returns null when the hunk adds nothing', () => {
    const lines = [line('normal', 'keep();'), line('delete', 'drop();')];

    expect(getChunkCopyText({ lines })).toBeNull();
  });
});
