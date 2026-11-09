import { ChevronsUpDown, MessageSquarePlus } from 'lucide-react';
import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { DiffSide } from '../../types/diff';
import { CommentButton } from '../components/CommentButton';
import { CommentForm } from '../components/CommentForm';
import { CommentThreadCard } from '../components/CommentThreadCard';
import { FrontmatterTable } from '../components/FrontmatterTable';
import type { PreparedBlocks } from '../utils/asciidoc';
import { extractFrontmatter } from '../utils/frontmatter';
import { computeFrontmatterDiff } from '../utils/frontmatterDiff';
import {
  alignMarkdownBlocks,
  diffRenderedText,
  findSourceLinesForText,
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownBlockRow,
} from '../utils/markdownBlocks';
import {
  blockOnSide,
  buildSplitPreviewItems,
  placeThreadsOnRows,
  type RowThreads,
} from '../utils/markdownSplitLayout';
import { isSafeUrl } from '../utils/markdownUtils';
import { addTextHighlights, createTextRanges, layoutText } from '../utils/textHighlights';
import { MIN_WORD_DIFF_SIMILARITY } from '../utils/wordLevelDiff';

import { getMarkdownComponents } from './markdownComponents';
import type { DiffViewerBodyProps } from './types';

type LineRange = { start: number; end: number };
type CommentTarget = LineRange & { side: DiffSide; rowIndex: number; initialBody?: string };
type SelectionTarget = LineRange & {
  side: DiffSide;
  rowIndex: number;
  quote: string;
  top: number;
  left: number;
};
type HoverTarget = LineRange & { top: number; height: number };

/**
 * split: before and after side by side (Split Preview). unified: one column, removed and
 * added blocks stacked (Diff Preview). single: one file, no diff (Full Preview).
 */
type MarkdownPreviewLayout = 'split' | 'unified' | 'single';

export type MarkdownSplitPreviewProps = Pick<
  DiffViewerBodyProps,
  | 'threads'
  | 'showAuthorBadges'
  | 'syntaxTheme'
  | 'onAddComment'
  | 'onGenerateThreadPrompt'
  | 'onRemoveThread'
  | 'onReplyToThread'
  | 'onRemoveMessage'
  | 'onUpdateMessage'
> & {
  filePath: string;
  /** null when the file does not exist on that side (added / deleted file). */
  baseContent: string | null;
  targetContent: string | null;
  baseLabel?: string;
  targetLabel?: string;
  /** single shows targetContent, or baseContent when targetContent is null. */
  layout?: MarkdownPreviewLayout;
  /** Blocks parsed and rendered elsewhere (AsciiDoc), instead of parsing the markdown. */
  blocks?: PreparedBlocks;
};

// The HTML of blocks rendered ahead of time, by block.
const BlockHtmlContext = createContext<Map<MarkdownBlock, string> | null>(null);

const NON_RENDERED_KINDS = new Set<MarkdownBlock['kind']>(['html', 'definition']);
const DEFINITION_KINDS = new Set<MarkdownBlock['kind']>(['definition', 'footnoteDefinition']);
const SELECTION_BUTTON_OFFSET = 12;
const SELECTION_BUTTON_HEIGHT = 28;
const SELECTION_BUTTON_WIDTH = 180;
const selectionButtonStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-yellow-btn-bg)',
  color: 'var(--color-yellow-btn-text)',
  border: '1px solid var(--color-yellow-btn-border)',
};

const splitLines = (content: string | null) =>
  (content ?? '').split('\n').map((line) => line.replace(/\r$/, ''));

const formatLineRange = ({ start, end }: LineRange) =>
  start === end ? `L${start}` : `L${start}-L${end}`;

const quoteSelection = (text: string) =>
  `${text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`;

const readLineRange = (element: Element | null | undefined): LineRange | null => {
  const start = Number(element?.getAttribute('data-md-line-start'));
  const end = Number(element?.getAttribute('data-md-line-end'));
  return start > 0 && end >= start ? { start, end } : null;
};

/** The part of `range` that lies inside `node`, as text. */
const selectedTextIn = (range: Range, node: Node) => {
  if (!range.intersectsNode(node)) return '';
  const part = document.createRange();
  part.selectNodeContents(node);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return part.toString();
};

const coversY = (element: Element, y: number) => {
  const rect = element.getBoundingClientRect();
  return y >= rect.top && y < rect.bottom;
};

// The preview whose block the pointer is on, so `c` acts in one preview only when a page
// shows several markdown files.
let hoveredPreview: HTMLElement | null = null;

// Without a hovered block, `c` comments on the block at this height of the viewport.
const KEYBOARD_ANCHOR_RATIO = 0.3;

const findBlockAtY = (container: HTMLElement, y: number): CommentTarget | null => {
  if (!coversY(container, y)) return null;
  const cells = Array.from(container.querySelectorAll('[data-md-cell]')).filter(
    (cell) => coversY(cell, y) && cell.querySelector('[data-md-line-start]'),
  );
  const cell = cells.find((c) => c.getAttribute('data-md-side') === 'new') ?? cells[0];
  if (!cell) return null;
  let anchor: Element | null = null;
  for (const element of cell.querySelectorAll('[data-md-line-start]')) {
    if (coversY(element, y)) anchor = element;
  }
  const range = readLineRange(anchor ?? cell.querySelector('[data-md-line-start]'));
  if (!range) return null;
  return {
    ...range,
    side: cell.getAttribute('data-md-side') === 'old' ? 'old' : 'new',
    rowIndex: Number(cell.getAttribute('data-md-row')),
  };
};

// Footnote definitions are appended to every block so `[^1]` renders as a reference; the
// section that remark-gfm then adds under the block would repeat the definition row.
const hideFootnoteSection = ({ className, children }: React.ComponentProps<'section'>) =>
  className?.includes('footnotes') ? null : <section className={className}>{children}</section>;

const toFootnoteDisplaySource = (source: string) =>
  source.replace(/^(\s*)\[\^([^\]]+)\]:\s?/, '$1\\[$2\\] ');

type FrontmatterPair = { old: MarkdownBlock | undefined; new: MarkdownBlock | undefined };

const readFrontmatter = (block: MarkdownBlock | undefined) =>
  block ? extractFrontmatter(`${block.source}\n`).data : null;

const BlockContent = memo(function BlockContent({
  block,
  definitions,
  syntaxTheme,
  frontmatterDiff,
}: {
  block: MarkdownBlock;
  definitions: string[];
  syntaxTheme?: DiffViewerBodyProps['syntaxTheme'];
  /** Set in the unified layout for an added or removed frontmatter: one key-by-key table. */
  frontmatterDiff?: FrontmatterPair;
}) {
  const components = useMemo(
    () => ({
      ...getMarkdownComponents(syntaxTheme, block.startLine - 1),
      section: hideFootnoteSection,
    }),
    [syntaxTheme, block.startLine],
  );
  const html = useContext(BlockHtmlContext)?.get(block);
  const lineAttributes = {
    'data-md-line-start': block.startLine,
    'data-md-line-end': block.endLine,
  };

  if (html !== undefined) {
    return (
      <div
        className="asciidoc-preview"
        {...lineAttributes}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (block.kind === 'frontmatter' && frontmatterDiff) {
    const entries = computeFrontmatterDiff(
      readFrontmatter(frontmatterDiff.old),
      readFrontmatter(frontmatterDiff.new),
    );
    return (
      <div {...lineAttributes}>
        <FrontmatterTable mode="diff" entries={entries} label="Frontmatter" />
      </div>
    );
  }

  if (block.kind === 'frontmatter') {
    const data = readFrontmatter(block);
    return (
      <div {...lineAttributes}>
        {data ? (
          <FrontmatterTable mode="snapshot" data={data} label="Frontmatter" />
        ) : (
          <pre className="whitespace-pre-wrap text-sm font-mono">{block.source}</pre>
        )}
      </div>
    );
  }

  if (NON_RENDERED_KINDS.has(block.kind)) {
    return (
      <pre
        className="whitespace-pre-wrap text-sm font-mono text-github-text-muted"
        {...lineAttributes}
      >
        {block.source}
      </pre>
    );
  }

  // Blocks render one by one, so references need the document's definitions.
  const blockSource =
    block.kind === 'footnoteDefinition' ? toFootnoteDisplaySource(block.source) : block.source;
  const source =
    definitions.length > 0 ? `${blockSource}\n\n${definitions.join('\n\n')}` : blockSource;
  return (
    <div className="space-y-4" {...lineAttributes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (isSafeUrl(url) ? url : '')}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

// A modified frontmatter renders as two snapshots instead, so each side's lines can take
// comments; one combined table would only accept new-side comments.
const getChangedFrontmatter = (row: MarkdownBlockRow): FrontmatterPair | undefined => {
  if (row.type !== 'added' && row.type !== 'removed') return undefined;
  const pair = { old: blockOnSide(row, 'old'), new: blockOnSide(row, 'new') };
  return (pair.old ?? pair.new)?.kind === 'frontmatter' ? pair : undefined;
};

const getCellSides = (
  row: MarkdownBlockRow,
  layout: MarkdownPreviewLayout,
  singleSide: DiffSide,
): DiffSide[] => {
  if (layout === 'split') return ['old', 'new'];
  if (layout === 'single') return [singleSide];
  if (row.type === 'modified') return ['old', 'new'];
  return row.type === 'removed' ? ['old'] : ['new'];
};

const getPaneStatus = (rowType: MarkdownBlockRow['type'], side: DiffSide) => {
  if (rowType === 'modified') return side === 'old' ? 'removed' : 'added';
  if (rowType === 'removed' && side === 'old') return 'removed';
  if (rowType === 'added' && side === 'new') return 'added';
  return null;
};

const PaneCell = memo(function PaneCell({
  side,
  rowIndex,
  rowType,
  block,
  definitions,
  syntaxTheme,
  formattingOnly,
  divided,
  frontmatterDiff,
  contentRef,
  dragSelected,
  commentSelected,
  onStartDrag,
  onHoverTarget,
}: {
  side: DiffSide;
  rowIndex: number;
  rowType: MarkdownBlockRow['type'];
  block: MarkdownBlock | undefined;
  definitions: string[];
  syntaxTheme?: DiffViewerBodyProps['syntaxTheme'];
  formattingOnly: boolean;
  divided: boolean;
  frontmatterDiff?: FrontmatterPair;
  contentRef: React.RefObject<HTMLDivElement | null>;
  dragSelected: boolean;
  commentSelected: boolean;
  onStartDrag: (target: CommentTarget) => void;
  onHoverTarget: (target: CommentTarget | null) => void;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  // The frontmatter diff table colors its own rows.
  const status = block && !frontmatterDiff ? getPaneStatus(rowType, side) : null;

  const handleMouseMove = (event: React.MouseEvent) => {
    const cell = cellRef.current;
    const target = event.target as Element;
    if (!cell || target.closest('[data-comment-button]')) return;
    let anchor: Element | null | undefined = target.closest('[data-md-line-start]');
    if (!anchor || !cell.contains(anchor)) {
      // In the gutter: take the innermost element at the pointer's height, so the table row
      // or list item the pointer came from stays selected.
      anchor = null;
      for (const element of cell.querySelectorAll('[data-md-line-start]')) {
        const rect = element.getBoundingClientRect();
        if (event.clientY >= rect.top && event.clientY < rect.bottom) anchor = element;
      }
      anchor ??= contentRef.current?.firstElementChild;
    }
    const range = anchor && cell.contains(anchor) ? readLineRange(anchor) : null;
    if (!anchor || !range) {
      setHover(null);
      onHoverTarget(null);
      return;
    }
    onHoverTarget({ ...range, side, rowIndex });
    const cellRect = cell.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const top = anchorRect.top - cellRect.top;
    setHover((previous) =>
      previous?.start === range.start && previous.end === range.end && previous.top === top
        ? previous
        : { ...range, top, height: anchorRect.height },
    );
  };

  const statusClass =
    status === 'removed'
      ? 'border-diff-deletion-border bg-diff-deletion-bg/40'
      : status === 'added'
        ? 'border-diff-addition-border bg-diff-addition-bg/40'
        : 'border-transparent';

  return (
    <div
      ref={cellRef}
      data-md-cell=""
      data-md-side={side}
      data-md-row={rowIndex}
      data-md-status={status ?? (block ? 'unchanged' : 'empty')}
      className={`relative min-w-0 border-l-4 py-2 pl-9 pr-4 ${statusClass} ${
        divided ? 'border-r border-r-github-border' : ''
      } ${block ? '' : 'md-split-spacer'} ${dragSelected ? 'md-drag-selected' : ''} ${
        commentSelected ? 'md-comment-selected' : ''
      }`}
      onMouseMove={block ? handleMouseMove : undefined}
      onMouseLeave={() => {
        setHover(null);
        onHoverTarget(null);
      }}
    >
      {block && (
        <div ref={contentRef} className="md-split-content">
          <BlockContent
            block={block}
            definitions={definitions}
            syntaxTheme={syntaxTheme}
            frontmatterDiff={frontmatterDiff}
          />
        </div>
      )}
      {formattingOnly && side === 'new' && (
        <span className="absolute right-2 top-1 rounded bg-github-bg-tertiary px-1.5 py-0.5 text-[10px] text-github-text-secondary">
          no visible text change
        </span>
      )}
      {hover && (
        <>
          <div
            className="pointer-events-none absolute left-7 w-0.5 rounded bg-yellow-400/70"
            style={{ top: hover.top, height: hover.height }}
          />
          <CommentButton
            title={`Add comment on ${formatLineRange(hover)}`}
            className="absolute left-1 h-6 w-6"
            style={{ top: hover.top }}
            onMouseDown={(event) => {
              event.preventDefault();
              onStartDrag({ side, rowIndex, start: hover.start, end: hover.end });
            }}
          />
        </>
      )}
    </div>
  );
});

/** The side whose block in this row lies within the range, if any. */
const selectedSide = (
  row: MarkdownBlockRow,
  range: (LineRange & { side: DiffSide }) | null,
): DiffSide | null => {
  const block = range && blockOnSide(row, range.side);
  return block && block.startLine <= range.end && block.endLine >= range.start ? range.side : null;
};

const SplitRow = memo(function SplitRow({
  row,
  rowIndex,
  layout,
  singleSide,
  oldDefinitions,
  newDefinitions,
  syntaxTheme,
  dragSelectedSide,
  commentSelectedSide,
  onStartDrag,
  onHoverTarget,
}: {
  row: MarkdownBlockRow;
  rowIndex: number;
  layout: MarkdownPreviewLayout;
  singleSide: DiffSide;
  oldDefinitions: string[];
  newDefinitions: string[];
  syntaxTheme?: DiffViewerBodyProps['syntaxTheme'];
  dragSelectedSide: DiffSide | null;
  commentSelectedSide: DiffSide | null;
  onStartDrag: (target: CommentTarget) => void;
  onHoverTarget: (target: CommentTarget | null) => void;
}) {
  const oldContentRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);
  const [formattingOnly, setFormattingOnly] = useState(false);

  useLayoutEffect(() => {
    const oldRoot = oldContentRef.current;
    const newRoot = newContentRef.current;
    if (row.type !== 'modified' || !oldRoot || !newRoot) return;

    let clearHighlights: Array<() => void> = [];
    const paint = () => {
      clearHighlights.forEach((clear) => clear());
      clearHighlights = [];
      const oldLayout = layoutText(oldRoot);
      const newLayout = layoutText(newRoot);
      const diff = diffRenderedText(oldLayout.text, newLayout.text);
      setFormattingOnly(diff.oldRanges.length === 0 && diff.newRanges.length === 0);
      if (diff.unchangedRatio < MIN_WORD_DIFF_SIMILARITY) return;
      clearHighlights = [
        addTextHighlights('difit-md-removed', createTextRanges(oldLayout, diff.oldRanges)),
        addTextHighlights('difit-md-added', createTextRanges(newLayout, diff.newRanges)),
      ];
    };
    paint();

    // Syntax highlighting and Mermaid render asynchronously and replace text nodes.
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    });
    const observed = { childList: true, subtree: true, characterData: true };
    observer.observe(oldRoot, observed);
    observer.observe(newRoot, observed);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearHighlights.forEach((clear) => clear());
    };
  }, [row]);

  const frontmatterDiff = layout === 'unified' ? getChangedFrontmatter(row) : undefined;

  return (
    <div
      className={`${layout === 'split' ? 'grid grid-cols-2' : ''} border-b border-github-border/30`}
      data-md-row-type={row.type}
    >
      {getCellSides(row, layout, singleSide).map((side) => (
        <PaneCell
          key={side}
          side={side}
          rowIndex={rowIndex}
          rowType={row.type}
          block={blockOnSide(row, side)}
          definitions={side === 'old' ? oldDefinitions : newDefinitions}
          syntaxTheme={syntaxTheme}
          formattingOnly={side === 'new' && row.type === 'modified' && formattingOnly}
          divided={layout === 'split' && side === 'old'}
          frontmatterDiff={frontmatterDiff}
          contentRef={side === 'old' ? oldContentRef : newContentRef}
          dragSelected={dragSelectedSide === side}
          commentSelected={commentSelectedSide === side}
          onStartDrag={onStartDrag}
          onHoverTarget={onHoverTarget}
        />
      ))}
    </div>
  );
});

export function MarkdownSplitPreview({
  filePath,
  baseContent,
  targetContent,
  baseLabel,
  targetLabel,
  layout = 'split',
  blocks,
  threads,
  showAuthorBadges,
  syntaxTheme,
  onAddComment,
  onGenerateThreadPrompt,
  onRemoveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
}: MarkdownSplitPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<SelectionTarget | null>(null);
  const selectingSideRef = useRef<DiffSide | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set());

  const oldBlocks = useMemo(
    () => blocks?.old ?? parseMarkdownBlocks(baseContent ?? ''),
    [blocks, baseContent],
  );
  const newBlocks = useMemo(
    () => blocks?.new ?? parseMarkdownBlocks(targetContent ?? ''),
    [blocks, targetContent],
  );
  const oldLines = useMemo(() => splitLines(baseContent), [baseContent]);
  const newLines = useMemo(() => splitLines(targetContent), [targetContent]);
  const oldDefinitions = useMemo(
    () =>
      oldBlocks.filter((block) => DEFINITION_KINDS.has(block.kind)).map((block) => block.source),
    [oldBlocks],
  );
  const newDefinitions = useMemo(
    () =>
      newBlocks.filter((block) => DEFINITION_KINDS.has(block.kind)).map((block) => block.source),
    [newBlocks],
  );
  const singleSide: DiffSide = targetContent === null ? 'old' : 'new';
  const rows = useMemo<MarkdownBlockRow[]>(() => {
    if (layout !== 'single') return alignMarkdownBlocks(oldBlocks, newBlocks);
    return (singleSide === 'old' ? oldBlocks : newBlocks).map((block) => ({
      type: 'unchanged',
      old: block,
      new: block,
    }));
  }, [layout, singleSide, oldBlocks, newBlocks]);
  const { byRow: threadsByRow, unplaced } = useMemo(() => {
    if (layout !== 'single') return placeThreadsOnRows(threads, rows);
    // The other side's line numbers do not point into this file, so list those threads on top.
    const isShownSide = (thread: (typeof threads)[number]) =>
      (thread.side === 'old' ? 'old' : 'new') === singleSide;
    const placed = placeThreadsOnRows(threads.filter(isShownSide), rows);
    return { ...placed, unplaced: [...placed.unplaced, ...threads.filter((t) => !isShownSide(t))] };
  }, [layout, singleSide, threads, rows]);
  const items = useMemo(() => {
    if (layout === 'single') return rows.map((_, index) => ({ kind: 'row' as const, index }));
    const pinned = new Set(threadsByRow.keys());
    if (commentTarget) pinned.add(commentTarget.rowIndex);
    return buildSplitPreviewItems(rows, pinned, expandedSections);
  }, [layout, rows, threadsByRow, commentTarget, expandedSections]);
  const hasRenderedChanges = layout === 'single' || rows.some((row) => row.type !== 'unchanged');

  const getSourceText = useCallback(
    ({ side, start, end }: LineRange & { side: DiffSide }) =>
      (side === 'old' ? oldLines : newLines).slice(start - 1, end).join('\n'),
    [oldLines, newLines],
  );

  const handleStartComment = useCallback((target: CommentTarget) => {
    setSelectionTarget(null);
    setCommentTarget((current) =>
      current &&
      !target.initialBody &&
      current.side === target.side &&
      current.start === target.start &&
      current.end === target.end
        ? null
        : target,
    );
  }, []);

  // Dragging from a gutter button over further blocks comments on the whole range,
  // like dragging over line numbers in the code diff.
  const [drag, setDrag] = useState<{ anchor: CommentTarget; current: CommentTarget } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const handleStartDrag = useCallback((target: CommentTarget) => {
    setDrag({ anchor: target, current: target });
  }, []);

  const hoverTargetRef = useRef<CommentTarget | null>(null);
  const handleHoverTarget = useCallback((target: CommentTarget | null) => {
    hoverTargetRef.current = target;
    if (target) hoveredPreview = containerRef.current;
    else if (hoveredPreview === containerRef.current) hoveredPreview = null;
    const current = dragRef.current;
    if (
      target &&
      current &&
      target.side === current.anchor.side &&
      (target.start !== current.current.start || target.end !== current.current.end)
    ) {
      setDrag({ ...current, current: target });
    }
  }, []);

  const dragRange = drag && {
    side: drag.anchor.side,
    start: Math.min(drag.anchor.start, drag.current.start),
    end: Math.max(drag.anchor.end, drag.current.end),
  };

  useEffect(() => {
    if (!drag) return undefined;
    const finish = () => {
      const { anchor, current } = drag;
      handleStartComment({
        side: anchor.side,
        // The form opens under the lowest row of the range.
        rowIndex: Math.max(anchor.rowIndex, current.rowIndex),
        start: Math.min(anchor.start, current.start),
        end: Math.max(anchor.end, current.end),
      });
      setDrag(null);
    };
    document.addEventListener('mouseup', finish);
    return () => document.removeEventListener('mouseup', finish);
  }, [drag, handleStartComment]);
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (hoveredPreview === container) hoveredPreview = null;
    };
  }, []);

  const handleSubmitComment = useCallback(
    async (body: string) => {
      if (!commentTarget) return;
      const { start, end, side } = commentTarget;
      await onAddComment(
        start === end ? start : [start, end],
        body,
        getSourceText(commentTarget),
        side,
      );
      setCommentTarget(null);
    },
    [commentTarget, getSourceText, onAddComment],
  );

  const handleMouseUp = useCallback(
    (event: MouseEvent) => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionTarget(null);
        return;
      }
      const range = selection.getRangeAt(0);
      // Old and new cells alternate in the DOM, so a selection over several rows also
      // covers cells of the other side. Keep the side the drag started on; without one,
      // the selected text must sit on a single side, since a quote that mixes before and
      // after text cannot point at source lines.
      const textCells = Array.from(container.querySelectorAll('[data-md-cell]'))
        .map((cell) => ({ cell, text: selectedTextIn(range, cell).trim() }))
        .filter(({ text }) => text);
      const textSides = new Set(textCells.map(({ cell }) => cell.getAttribute('data-md-side')));
      const side =
        selectingSideRef.current ?? (textSides.size === 1 ? [...textSides][0] : undefined);
      const cells = textCells.filter(({ cell }) => cell.getAttribute('data-md-side') === side);
      const endCell = cells[cells.length - 1]?.cell;
      // Line ranges come from the innermost blocks holding selected text, so a drag that
      // ends in the padding or the gutter still counts.
      const lineElements = cells
        .flatMap(({ cell }) => Array.from(cell.querySelectorAll('[data-md-line-start]')))
        .filter((element) => selectedTextIn(range, element).trim());
      const lineRanges = lineElements
        .filter(
          (element) => !lineElements.some((other) => other !== element && element.contains(other)),
        )
        .map(readLineRange)
        .filter((lineRange): lineRange is LineRange => lineRange !== null);
      const quote = cells.map(({ text }) => text).join('\n\n');
      if ((side !== 'old' && side !== 'new') || !endCell || lineRanges.length === 0) {
        setSelectionTarget(null);
        return;
      }

      const enclosing = {
        start: Math.min(...lineRanges.map(({ start }) => start)),
        end: Math.max(...lineRanges.map(({ end }) => end)),
      };
      const sourceLines = (side === 'old' ? oldLines : newLines).slice(
        enclosing.start - 1,
        enclosing.end,
      );
      const lines = findSourceLinesForText(sourceLines, enclosing.start, quote) ?? enclosing;
      // Place the button where the mouse was released. The selection's bounding box spans
      // whole lines, which puts the button far from the cursor on multi-line selections.
      const containerRect = container.getBoundingClientRect();
      const rects = range.getClientRects();
      const lastRect = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const hasPointer = event.clientX !== 0 || event.clientY !== 0;
      const x = hasPointer ? event.clientX : lastRect.right;
      const y = hasPointer ? event.clientY : lastRect.bottom;
      const fitsBelow = y + SELECTION_BUTTON_OFFSET + SELECTION_BUTTON_HEIGHT <= window.innerHeight;
      setSelectionTarget({
        ...lines,
        side,
        rowIndex: Number(endCell.getAttribute('data-md-row')),
        quote,
        top:
          y -
          containerRect.top +
          (fitsBelow
            ? SELECTION_BUTTON_OFFSET
            : -SELECTION_BUTTON_OFFSET - SELECTION_BUTTON_HEIGHT),
        left: Math.max(
          0,
          Math.min(x - containerRect.left - 16, containerRect.width - SELECTION_BUTTON_WIDTH),
        ),
      });
    },
    [oldLines, newLines],
  );

  // `c` quotes the selected text, else comments on the hovered block, else on the block
  // near the top of the viewport.
  useHotkeys(
    'c',
    (event) => {
      const container = containerRef.current;
      if (!container) return;
      let target: CommentTarget | null;
      if (selectionTarget) {
        target = {
          side: selectionTarget.side,
          rowIndex: selectionTarget.rowIndex,
          start: selectionTarget.start,
          end: selectionTarget.end,
          initialBody: quoteSelection(selectionTarget.quote),
        };
        window.getSelection()?.removeAllRanges();
      } else if (!(window.getSelection()?.isCollapsed ?? true)) {
        // The selection belongs to another preview.
        return;
      } else if (hoveredPreview) {
        target = hoveredPreview === container ? hoverTargetRef.current : null;
      } else {
        target = findBlockAtY(container, window.innerHeight * KEYBOARD_ANCHOR_RATIO);
      }
      if (!target) return;
      event.preventDefault();
      handleStartComment(target);
    },
    { scopes: 'navigation', enableOnFormTags: false },
    [selectionTarget, handleStartComment],
  );

  // The side stays marked until the next mousedown, so the browser keeps the other column
  // out of the selection (global.css) while the user reads it.
  const handleMouseDown = (event: React.MouseEvent) => {
    const side = (event.target as Element).closest('[data-md-cell]')?.getAttribute('data-md-side');
    selectingSideRef.current = side === 'old' || side === 'new' ? side : null;
    if (selectingSideRef.current) {
      event.currentTarget.setAttribute('data-md-select-side', selectingSideRef.current);
    } else {
      event.currentTarget.removeAttribute('data-md-select-side');
    }
  };

  // On the document, so a drag that ends outside the preview still offers the button.
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  useEffect(() => {
    if (!selectionTarget) return;
    const hideWhenCollapsed = () => {
      if (window.getSelection()?.isCollapsed ?? true) setSelectionTarget(null);
    };
    document.addEventListener('selectionchange', hideWhenCollapsed);
    return () => document.removeEventListener('selectionchange', hideWhenCollapsed);
  }, [selectionTarget]);

  const renderThreadCard = (thread: RowThreads['new'][number]) => (
    <div key={thread.id} className="m-2 mx-3">
      <CommentThreadCard
        thread={thread}
        showAuthorBadges={showAuthorBadges}
        onGeneratePrompt={onGenerateThreadPrompt}
        onRemoveThread={onRemoveThread}
        onReplyToThread={onReplyToThread}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={onUpdateMessage}
        syntaxTheme={syntaxTheme}
      />
    </div>
  );

  const renderSideComments = (rowIndex: number, side: DiffSide) => {
    const rowThreads = threadsByRow.get(rowIndex)?.[side] ?? [];
    const isCommentingHere = commentTarget?.rowIndex === rowIndex && commentTarget.side === side;
    return (
      <div
        key={side}
        className={`min-w-0 ${layout === 'split' && side === 'old' ? 'border-r border-github-border' : ''}`}
      >
        {rowThreads.map(renderThreadCard)}
        {isCommentingHere && commentTarget && (
          <CommentForm
            key={`${commentTarget.start}-${commentTarget.end}-${commentTarget.initialBody ?? ''}`}
            onSubmit={handleSubmitComment}
            onCancel={() => setCommentTarget(null)}
            selectedCode={getSourceText(commentTarget)}
            syntaxTheme={syntaxTheme}
            filename={filePath}
            initialValue={commentTarget.initialBody}
            title={`Comment on ${formatLineRange(commentTarget)}${side === 'old' ? ' (before)' : ''}`}
          />
        )}
      </div>
    );
  };

  const expandSection = (start: number) =>
    setExpandedSections((current) => new Set(current).add(start));

  return (
    <BlockHtmlContext.Provider value={blocks?.html ?? null}>
      <div
        ref={containerRef}
        className="relative"
        data-testid={`markdown-${layout}-preview`}
        onMouseDown={handleMouseDown}
      >
        {layout === 'split' && (
          <div className="grid grid-cols-2 border-b border-github-border bg-github-bg-secondary text-xs text-github-text-secondary">
            <div className="border-r border-github-border px-4 py-2">
              <span className="font-semibold text-github-text-primary">Before</span>
              {baseContent === null ? (
                <span className="ml-2">file does not exist</span>
              ) : (
                baseLabel && <code className="ml-2 font-mono">{baseLabel}</code>
              )}
            </div>
            <div className="px-4 py-2">
              <span className="font-semibold text-github-text-primary">After</span>
              {targetContent === null ? (
                <span className="ml-2">file deleted</span>
              ) : (
                targetLabel && <code className="ml-2 font-mono">{targetLabel}</code>
              )}
            </div>
          </div>
        )}

        {!hasRenderedChanges && rows.length > 0 && (
          <div className="px-4 py-2 text-sm text-github-text-muted">
            No rendered changes — the diff only touches blank lines or whitespace.
          </div>
        )}

        {unplaced.length > 0 && (
          <div className="border-b border-github-border bg-github-bg-secondary">
            {unplaced.map(renderThreadCard)}
          </div>
        )}

        {items.map((item) => {
          if (item.kind === 'collapsed') {
            const hiddenCount = item.end - item.start;
            return (
              <button
                key={`collapsed-${item.start}`}
                type="button"
                className="flex w-full items-center justify-center gap-2 border-b border-github-border bg-github-bg-secondary py-1.5 text-xs text-github-text-secondary hover:bg-github-bg-tertiary hover:text-github-text-primary"
                onClick={() => expandSection(item.start)}
              >
                <ChevronsUpDown size={14} />
                Show {hiddenCount} unchanged {hiddenCount === 1 ? 'block' : 'blocks'}
              </button>
            );
          }

          const row = rows[item.index];
          if (!row) return null;
          const hasComments =
            threadsByRow.has(item.index) || commentTarget?.rowIndex === item.index;
          return (
            <React.Fragment key={`row-${item.index}`}>
              <SplitRow
                row={row}
                rowIndex={item.index}
                layout={layout}
                singleSide={singleSide}
                oldDefinitions={oldDefinitions}
                newDefinitions={newDefinitions}
                syntaxTheme={syntaxTheme}
                dragSelectedSide={selectedSide(row, dragRange)}
                commentSelectedSide={dragRange ? null : selectedSide(row, commentTarget)}
                onStartDrag={handleStartDrag}
                onHoverTarget={handleHoverTarget}
              />
              {hasComments && (
                <div
                  className={`${layout === 'split' ? 'grid grid-cols-2' : ''} border-b border-github-border bg-github-bg-secondary`}
                >
                  {(layout === 'single' ? [singleSide] : (['old', 'new'] as const)).map((side) =>
                    renderSideComments(item.index, side),
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}

        {selectionTarget && (
          <button
            type="button"
            data-md-selection-comment=""
            className="absolute z-20 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium shadow-lg"
            style={{
              ...selectionButtonStyle,
              top: selectionTarget.top,
              left: selectionTarget.left,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onMouseUp={(event) => event.stopPropagation()}
            onClick={() => {
              handleStartComment({
                side: selectionTarget.side,
                rowIndex: selectionTarget.rowIndex,
                start: selectionTarget.start,
                end: selectionTarget.end,
                initialBody: quoteSelection(selectionTarget.quote),
              });
              window.getSelection()?.removeAllRanges();
            }}
          >
            <MessageSquarePlus size={14} />
            Comment on {formatLineRange(selectionTarget)}
          </button>
        )}
      </div>
    </BlockHtmlContext.Provider>
  );
}
