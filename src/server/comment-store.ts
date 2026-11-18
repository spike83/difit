import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { DiffCommentThread, DiffSelection } from '../types/diff.js';

interface CommentFile {
  version: 1;
  selection: DiffSelection;
  threads: DiffCommentThread[];
}

/**
 * Comment threads kept on disk under <git dir>/difit/comments, one file per diff selection as
 * the user requested it (e.g. `main...HEAD`), so a review outlives the server and new commits.
 */
export class CommentStore {
  constructor(private readonly dir: string) {}

  private pathFor(key: string): string {
    const safe = key.replace(/[^\w.-]+/g, '_').slice(0, 80);
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
    return join(this.dir, `${safe}-${hash}.json`);
  }

  /** The stored threads, or null when this selection has no file yet. */
  load(key: string): DiffCommentThread[] | null {
    let raw: string;
    try {
      raw = readFileSync(this.pathFor(key), 'utf8');
    } catch {
      return null;
    }
    try {
      const data = JSON.parse(raw) as Partial<CommentFile>;
      return Array.isArray(data.threads) ? data.threads : [];
    } catch (error) {
      console.error(`Ignoring unreadable comment file ${this.pathFor(key)}:`, error);
      return null;
    }
  }

  save(key: string, selection: DiffSelection, threads: DiffCommentThread[]): void {
    const path = this.pathFor(key);
    const data: CommentFile = { version: 1, selection, threads };
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
      renameSync(tmp, path);
    } catch (error) {
      console.error(`Failed to save comments to ${path}:`, error);
    }
  }
}
