import type { DiffChunk, DiffLine } from '../../types/diff';

const isNewSideLine = (line: DiffLine) =>
  line.type === 'add' || line.type === 'normal' || line.type === 'context';
const isOldSideLine = (line: DiffLine) =>
  line.type === 'delete' ||
  line.type === 'remove' ||
  line.type === 'normal' ||
  line.type === 'context';

// The hunk as it reads after the change; a pure deletion falls back to the removed lines.
export function getChunkCopyText(chunk: Pick<DiffChunk, 'lines'>): string {
  const hasNewSide = chunk.lines.some((line) => line.type === 'add');
  const hasOldSide = chunk.lines.some((line) => line.type === 'delete' || line.type === 'remove');
  const keep = !hasNewSide && hasOldSide ? isOldSideLine : isNewSideLine;
  return chunk.lines
    .filter(keep)
    .map((line) => line.content)
    .join('\n');
}
