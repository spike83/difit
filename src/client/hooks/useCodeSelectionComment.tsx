import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHotkeys } from 'react-hotkeys-hook';

import type { DiffSide, LineNumber } from '../../types/diff';
import { SelectionCommentButton } from '../components/SelectionCommentButton';
import { quoteSelection, selectedTextIn, selectionButtonPosition } from '../utils/selectionComment';

type SelectionTarget = {
  side: DiffSide;
  start: number;
  end: number;
  quote: string;
  top: number;
  left: number;
};

/** Selected text of a code cell, without the unified view's +/- prefix in front of it. */
const selectedCodeIn = (range: Range, cell: Element) => {
  const text = selectedTextIn(range, cell);
  const prefix = cell.querySelector('[data-code-prefix]');
  return prefix ? text.slice(selectedTextIn(range, prefix).length) : text;
};

/** Marks a code cell as selectable source text of one side and line. */
export const codeCellProps = (side: DiffSide, lineNumber: number | undefined) =>
  lineNumber ? { 'data-code-side': side, 'data-code-line': lineNumber } : {};

/**
 * Selecting text in a diff chunk offers a button, and `c`, that start a comment on the
 * selected lines quoting the text. Code cells carry `codeCellProps`; the container gets
 * `containerRef` and `onMouseDown`, which keeps the selection on the side it started on
 * (global.css).
 */
export function useCodeSelectionComment(
  onComment: (side: DiffSide, lineNumber: LineNumber, initialBody: string) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectingSideRef = useRef<DiffSide | null>(null);
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  // The selection and where it was on screen, so the button can follow it when the diff scrolls.
  const anchorRef = useRef<{ range: Range; top: number; left: number } | null>(null);

  const onMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    const side = (event.target as Element)
      .closest('[data-code-side]')
      ?.getAttribute('data-code-side');
    selectingSideRef.current = side === 'old' || side === 'new' ? side : null;
    if (selectingSideRef.current) {
      event.currentTarget.setAttribute('data-code-select-side', selectingSideRef.current);
    } else {
      event.currentTarget.removeAttribute('data-code-select-side');
    }
  };

  const handleMouseUp = useCallback((event: MouseEvent) => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setTarget(null);
      return;
    }
    const range = selection.getRangeAt(0);
    // A comment covers lines of one chunk, so a selection across chunks gets no button.
    if (!container.contains(range.commonAncestorContainer)) {
      setTarget(null);
      return;
    }
    const cells = Array.from(container.querySelectorAll('[data-code-side]'))
      .map((cell) => ({ cell, text: selectedCodeIn(range, cell) }))
      .filter(({ text }) => text.trim());
    const sides = new Set(cells.map(({ cell }) => cell.getAttribute('data-code-side')));
    const side = selectingSideRef.current ?? (sides.size === 1 ? [...sides][0] : undefined);
    const onSide = cells.filter(({ cell }) => cell.getAttribute('data-code-side') === side);
    if ((side !== 'old' && side !== 'new') || onSide.length === 0) {
      setTarget(null);
      return;
    }
    const lines = onSide.map(({ cell }) => Number(cell.getAttribute('data-code-line')));
    const rect = range.getBoundingClientRect();
    anchorRef.current = { range: range.cloneRange(), top: rect.top, left: rect.left };
    setTarget({
      side,
      start: Math.min(...lines),
      end: Math.max(...lines),
      quote: onSide.map(({ text }) => text).join('\n'),
      // On the page, not in the chunk: the diff body clips what overflows it.
      ...selectionButtonPosition(event, range, document.documentElement),
    });
  }, []);

  // On the document, so a drag that ends outside the chunk still offers the button.
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  // The diff scrolls inside its own container, not the page the button is placed on.
  const isShown = target !== null;
  useEffect(() => {
    if (!isShown) return;
    const follow = (event: Event) => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.range.getBoundingClientRect();
      const dy = rect.top - anchor.top;
      const dx = rect.left - anchor.left;
      anchor.top = rect.top;
      anchor.left = rect.left;
      // A page scroll carries the button along already.
      if (event.target === document || (dy === 0 && dx === 0)) return;
      setTarget((current) =>
        current ? { ...current, top: current.top + dy, left: current.left + dx } : current,
      );
    };
    document.addEventListener('scroll', follow, true);
    return () => document.removeEventListener('scroll', follow, true);
  }, [isShown]);

  useEffect(() => {
    if (!target) return;
    const hideWhenCollapsed = () => {
      if (window.getSelection()?.isCollapsed ?? true) setTarget(null);
    };
    document.addEventListener('selectionchange', hideWhenCollapsed);
    return () => document.removeEventListener('selectionchange', hideWhenCollapsed);
  }, [target]);

  const startComment = useCallback(() => {
    if (!target) return;
    onComment(
      target.side,
      target.start === target.end ? target.start : [target.start, target.end],
      quoteSelection(target.quote),
    );
    setTarget(null);
    window.getSelection()?.removeAllRanges();
  }, [target, onComment]);

  useHotkeys(
    'c',
    (event) => {
      if (!target) return;
      event.preventDefault();
      startComment();
    },
    { scopes: 'navigation', enableOnFormTags: false },
    [target, startComment],
  );

  const selectionButton = target
    ? createPortal(
        <SelectionCommentButton
          start={target.start}
          end={target.end}
          top={target.top}
          left={target.left}
          onClick={startComment}
        />,
        document.body,
      )
    : null;

  return { containerRef, onMouseDown, selectionButton };
}
