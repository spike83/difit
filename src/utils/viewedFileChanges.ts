import type { DiffFile } from '../types/diff.js';

// Snapshots of bigger diffs are not kept, so localStorage stays small.
const MAX_SNAPSHOT_LINES = 2000;
const MAX_SHOWN_LINES = 8;

type ChangeLine = { key: string; label: string; line?: number };

function changeLinesOf(file: DiffFile): ChangeLine[] {
  return file.chunks.flatMap((chunk) =>
    chunk.lines.flatMap((line) => {
      if (line.type === 'add') {
        return [{ key: `+${line.content}`, label: `+${line.content}`, line: line.newLineNumber }];
      }
      if (line.type === 'delete' || line.type === 'remove') {
        return [{ key: `-${line.content}`, label: `-${line.content}` }];
      }
      return [];
    }),
  );
}

/** The added/removed lines of a file's diff, or undefined when the diff is too big to keep. */
export function snapshotChangeLines(file: DiffFile): string[] | undefined {
  const lines = changeLinesOf(file).map(({ key }) => key);
  return lines.length <= MAX_SNAPSHOT_LINES ? lines : undefined;
}

function formatRanges(lines: number[]): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    if (start !== undefined && prev !== undefined && line === prev + 1) {
      prev = line;
      continue;
    }
    if (start !== undefined) ranges.push(start === prev ? `L${start}` : `L${start}-L${prev}`);
    start = prev = line;
  }
  if (start !== undefined) ranges.push(start === prev ? `L${start}` : `L${start}-L${prev}`);
  return ranges.join(', ');
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The comment that explains why a viewed file became unviewed. */
export function describeViewedFileChange(file: DiffFile, previous: string[] | undefined): string {
  const head = 'Changed after it was marked viewed, so it is unviewed again.';
  if (!previous) {
    return `${head}\n\nThere is no snapshot of the viewed version to compare with.`;
  }

  const remaining = new Map<string, number>();
  for (const key of previous) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const added: ChangeLine[] = [];
  for (const change of changeLinesOf(file)) {
    const count = remaining.get(change.key) ?? 0;
    if (count > 0) remaining.set(change.key, count - 1);
    else added.push(change);
  }
  const gone = [...remaining.values()].reduce((sum, count) => sum + count, 0);

  const parts = [head, ''];
  if (added.length > 0) {
    const plus = added.filter(({ key }) => key.startsWith('+')).length;
    const lineNumbers = added.flatMap(({ line }) => (line ? [line] : []));
    const where = lineNumbers.length > 0 ? ` (${formatRanges(lineNumbers)})` : '';
    parts.push(
      `New in the diff: ${plural(plus, 'added line')}, ${plural(added.length - plus, 'removed line')}${where}.`,
    );
  }
  if (gone > 0) {
    parts.push(`No longer in the diff: ${plural(gone, 'line')} (changed back or rewritten).`);
  }
  if (added.length === 0 && gone === 0) {
    parts.push('Only the unchanged lines around the changes moved.');
  }
  if (added.length > 0) {
    const shown = added.slice(0, MAX_SHOWN_LINES).map(({ label }) => label);
    if (added.length > MAX_SHOWN_LINES) shown.push(`… ${added.length - MAX_SHOWN_LINES} more`);
    parts.push('', '```diff', ...shown, '```');
  }
  return parts.join('\n');
}
