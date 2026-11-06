import { type DiffFile } from '../../types/diff';
import { type MergedChunk } from '../hooks/useExpandedLines';

interface MergedChunksState {
  diffVersion: number | null;
  byFile: Map<string, MergedChunk[]>;
}

export const EMPTY_MERGED_CHUNKS_STATE: MergedChunksState = {
  diffVersion: null,
  byFile: new Map(),
};

// -1 after the last hunk means the file length isn't known yet, so lines may still be hidden.
export const chunksHaveHiddenLines = (chunks: MergedChunk[]) =>
  chunks.some((chunk) => chunk.hiddenLinesBefore > 0 || chunk.hiddenLinesAfter !== 0);

export const chunksHaveExpandedLines = (chunks: MergedChunk[]) =>
  chunks.some((chunk) => chunk.lines.some((line) => 'isExpanded' in line && line.isExpanded));

export function buildMergedChunksState(
  diffVersion: number,
  renderedFilePaths: Set<string>,
  filesByPath: Map<string, DiffFile>,
  getMergedChunks: (file: DiffFile) => MergedChunk[],
): MergedChunksState {
  const next = new Map<string, MergedChunk[]>();

  renderedFilePaths.forEach((path) => {
    const file = filesByPath.get(path);
    if (!file) return;
    next.set(path, getMergedChunks(file));
  });

  return {
    diffVersion,
    byFile: next,
  };
}

export function getMergedChunksForVersion(
  state: MergedChunksState,
  diffVersion: number,
  filePath: string,
): MergedChunk[] | undefined {
  if (state.diffVersion !== diffVersion) {
    return undefined;
  }

  return state.byFile.get(filePath);
}
