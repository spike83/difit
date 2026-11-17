// Shared by the markdown preview and the code diff: selecting text offers a button (and
// `c`) that starts a comment quoting the selection.

export const quoteSelection = (text: string) =>
  `${text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join('\n')}\n\n`;

/** The part of `range` that lies inside `node`, as text. */
export const selectedTextIn = (range: Range, node: Node) => {
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

export const formatLineRange = ({ start, end }: { start: number; end: number }) =>
  start === end ? `L${start}` : `L${start}-L${end}`;

const SELECTION_BUTTON_OFFSET = 12;
const SELECTION_BUTTON_HEIGHT = 28;
const SELECTION_BUTTON_WIDTH = 180;

/**
 * Where the button goes, relative to `container`: where the mouse was released. The
 * selection's bounding box spans whole lines, which puts the button far from the cursor on
 * multi-line selections.
 */
export const selectionButtonPosition = (
  event: MouseEvent,
  range: Range,
  container: HTMLElement,
) => {
  const containerRect = container.getBoundingClientRect();
  const rects = range.getClientRects();
  const lastRect = rects[rects.length - 1] ?? range.getBoundingClientRect();
  const hasPointer = event.clientX !== 0 || event.clientY !== 0;
  const x = hasPointer ? event.clientX : lastRect.right;
  const y = hasPointer ? event.clientY : lastRect.bottom;
  const fitsBelow = y + SELECTION_BUTTON_OFFSET + SELECTION_BUTTON_HEIGHT <= window.innerHeight;
  return {
    top:
      y -
      containerRect.top +
      (fitsBelow ? SELECTION_BUTTON_OFFSET : -SELECTION_BUTTON_OFFSET - SELECTION_BUTTON_HEIGHT),
    left: Math.max(
      0,
      Math.min(x - containerRect.left - 16, containerRect.width - SELECTION_BUTTON_WIDTH),
    ),
  };
};
