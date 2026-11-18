import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../types/diff.js';

import { CommentStore } from './comment-store.js';

const thread: DiffCommentThread = {
  id: 't1',
  filePath: 'src/a.ts',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  position: { side: 'new', line: 1 },
  messages: [
    {
      id: 't1',
      body: 'Hi',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};
const selection = {
  baseCommitish: 'main',
  targetCommitish: 'HEAD',
  baseMode: 'merge-base' as const,
};

describe('CommentStore', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a selection without a file and round-trips saved threads', () => {
    dir = mkdtempSync(join(tmpdir(), 'difit-store-'));
    const commentDir = join(dir, 'comments');
    const store = new CommentStore(commentDir);

    expect(store.load('main:HEAD:merge-base')).toBeNull();
    store.save('main:HEAD:merge-base', selection, [thread]);

    expect(new CommentStore(commentDir).load('main:HEAD:merge-base')).toEqual([thread]);
    expect(store.load('other:HEAD:direct')).toBeNull();
    expect(readdirSync(commentDir)).toEqual([
      expect.stringMatching(/^main_HEAD_merge-base-[0-9a-f]{8}\.json$/),
    ]);
  });

  it('treats an unreadable file as missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'difit-store-'));
    const store = new CommentStore(dir);
    store.save('k', selection, [thread]);
    const [file] = readdirSync(dir);
    writeFileSync(join(dir, file ?? ''), '{broken');

    expect(store.load('k')).toBeNull();
  });
});
