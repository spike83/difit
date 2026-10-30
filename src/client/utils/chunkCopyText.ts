import type { DiffChunk } from '../../types/diff';

export function getChunkCopyText(chunk: Pick<DiffChunk, 'lines'>): string | null {
  const added = chunk.lines.filter((line) => line.type === 'add');
  return added.length > 0 ? added.map((line) => line.content).join('\n') : null;
}
