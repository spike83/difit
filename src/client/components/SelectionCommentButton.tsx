import { MessageSquarePlus } from 'lucide-react';
import React, { useEffect } from 'react';

import { formatLineRange } from '../utils/selectionComment';

const buttonStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-yellow-btn-bg)',
  color: 'var(--color-yellow-btn-text)',
  border: '1px solid var(--color-yellow-btn-border)',
};

// How many buttons are shown, so the cursor's `c` leaves the key to the selection.
let shownButtons = 0;
export const isSelectionCommentOffered = () => shownButtons > 0;

interface SelectionCommentButtonProps {
  start: number;
  end: number;
  top: number;
  left: number;
  onClick: () => void;
}

/** Floats next to selected text; its parent must be positioned. */
export function SelectionCommentButton({
  start,
  end,
  top,
  left,
  onClick,
}: SelectionCommentButtonProps) {
  useEffect(() => {
    shownButtons++;
    return () => {
      shownButtons--;
    };
  }, []);

  return (
    <button
      type="button"
      className="absolute z-20 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium shadow-lg"
      style={{ ...buttonStyle, top, left }}
      // Keep the selection while clicking, and don't let the click count as a new selection.
      onMouseDown={(event) => event.preventDefault()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      <MessageSquarePlus size={14} />
      Comment on {formatLineRange({ start, end })}
    </button>
  );
}
