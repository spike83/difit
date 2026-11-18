import { X } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

import type { CommentThread } from '../../types/diff';
import {
  COMMENT_FILTERS,
  type CommentFilter,
  matchesCommentFilter,
} from '../../utils/commentState';
import { useCommentActions } from '../contexts/CommentActionsContext';
import { hasActiveTextSelection } from '../utils/domUtils';

import { CommentThreadCard } from './CommentThreadCard';
import type { AppearanceSettings } from './SettingsModal';

interface CommentsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (thread: CommentThread) => void;
  comments: CommentThread[];
  showAuthorBadges?: boolean;
  onRemoveThread: (threadId: string) => void;
  onGenerateThreadPrompt: (thread: CommentThread) => string;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  /** The filter tab shown when the list opens. */
  initialFilter?: CommentFilter;
}

export function CommentsListModal({
  isOpen,
  onClose,
  onNavigate,
  comments,
  showAuthorBadges = false,
  onRemoveThread,
  onGenerateThreadPrompt,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  syntaxTheme,
  initialFilter = 'open',
}: CommentsListModalProps) {
  const { reopenThread } = useCommentActions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<CommentFilter>(initialFilter);
  useEffect(() => {
    if (isOpen) setFilter(initialFilter);
  }, [initialFilter, isOpen]);
  // Reading a thread here marks it read; it stays in the Unread tab until the list closes or
  // the tab changes, so it doesn't vanish under the mouse.
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setKeptIds(
      isOpen && filter === 'unread'
        ? new Set(
            comments
              .filter((thread) => matchesCommentFilter(thread, 'unread'))
              .map((thread) => thread.id),
          )
        : new Set(),
    );
    // Only when the tab opens: later reads must not shrink the kept set.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [filter, isOpen]);
  const commentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { enableScope, disableScope } = useHotkeysContext();

  const sortedThreads = comments
    .filter((thread) => matchesCommentFilter(thread, filter) || keptIds.has(thread.id))
    .sort((a, b) => {
      const fileCompare = a.file.localeCompare(b.file);
      if (fileCompare !== 0) return fileCompare;

      const aLine = Array.isArray(a.line) ? a.line[0] : a.line;
      const bLine = Array.isArray(b.line) ? b.line[0] : b.line;
      if (aLine !== bLine) return aLine - bLine;

      return a.createdAt.localeCompare(b.createdAt);
    });

  const handleThreadClick = useCallback(
    (thread: CommentThread) => {
      onNavigate(thread);
      onClose();
    },
    [onClose, onNavigate],
  );

  // Resolving is undone with Reopen, so it needs no confirmation.
  const handleResolveThread = useCallback(
    (thread: CommentThread) => {
      if (thread.resolved) return;
      onRemoveThread(thread.id);
      if (filter !== 'resolved' && selectedIndex >= sortedThreads.length - 1 && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    },
    [filter, onRemoveThread, selectedIndex, sortedThreads.length],
  );

  useEffect(() => {
    if (isOpen) {
      enableScope('comments-list');
      disableScope('navigation');
    } else {
      enableScope('navigation');
      disableScope('comments-list');
      setSelectedIndex(0);
    }

    return () => {
      enableScope('navigation');
      disableScope('comments-list');
    };
  }, [disableScope, enableScope, isOpen]);

  const hotkeyOptions = { scopes: 'comments-list', enableOnFormTags: false };

  useHotkeys('escape', () => onClose(), hotkeyOptions, [onClose]);

  useHotkeys(
    'j, down',
    () => setSelectedIndex((prev) => Math.min(prev + 1, sortedThreads.length - 1)),
    hotkeyOptions,
    [sortedThreads.length],
  );

  useHotkeys('k, up', () => setSelectedIndex((prev) => Math.max(prev - 1, 0)), hotkeyOptions, []);

  useHotkeys(
    'enter',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleThreadClick(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleThreadClick, selectedIndex, sortedThreads],
  );

  useHotkeys(
    'd',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleResolveThread(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleResolveThread, selectedIndex, sortedThreads],
  );

  useHotkeys(
    'r',
    () => {
      const thread = sortedThreads[selectedIndex];
      if (thread?.resolved) reopenThread?.(thread.id);
    },
    hotkeyOptions,
    [reopenThread, selectedIndex, sortedThreads],
  );

  useEffect(() => {
    if (commentRefs.current[selectedIndex]) {
      commentRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-github-border bg-github-bg-primary shadow-lg">
        <div className="sticky top-0 border-b border-github-border bg-github-bg-primary px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-github-text-primary">All Comments</h2>
            <button
              onClick={onClose}
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
              aria-label="Close comments list"
            >
              <X size={20} />
            </button>
          </div>
          <div className="text-xs text-github-text-secondary">
            <span className="font-mono">j/k</span> or <span className="font-mono">↑/↓</span> to
            navigate • <span className="font-mono">Enter</span> to jump •{' '}
            <span className="font-mono">d</span> to resolve • <span className="font-mono">r</span>{' '}
            to reopen • <span className="font-mono">Esc</span> to close
          </div>
          <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter comments">
            {COMMENT_FILTERS.map(({ id, label }) => {
              const count = comments.filter((thread) => matchesCommentFilter(thread, id)).length;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => {
                    setFilter(id);
                    setSelectedIndex(0);
                  }}
                  className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${
                    filter === id
                      ? 'border-blue-500 bg-blue-500/15 text-github-text-primary'
                      : 'border-github-border text-github-text-secondary hover:bg-github-bg-secondary'
                  }`}
                >
                  {label} {count}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[calc(80vh-120px)] overflow-y-auto">
          <div className="p-6">
            {sortedThreads.length === 0 ? (
              <p className="text-center text-github-text-secondary">
                {comments.length === 0 ? 'No comments yet' : 'No threads match this filter'}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {sortedThreads.map((thread, index) => (
                    <div
                      key={thread.id}
                      ref={(el) => {
                        commentRefs.current[index] = el;
                      }}
                      className={selectedIndex === index ? 'rounded ring-2 ring-blue-500' : ''}
                    >
                      <CommentThreadCard
                        thread={thread}
                        showAuthorBadges={showAuthorBadges}
                        confirmRootAction={false}
                        onGeneratePrompt={onGenerateThreadPrompt}
                        onRemoveThread={(threadId) => {
                          if (threadId === thread.id) {
                            handleResolveThread(thread);
                          }
                        }}
                        onReplyToThread={onReplyToThread}
                        onRemoveMessage={onRemoveMessage}
                        onUpdateMessage={onUpdateMessage}
                        syntaxTheme={syntaxTheme}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Selecting text inside a card fires a click as well; do not
                          // treat it as a request to navigate and close the modal.
                          if (hasActiveTextSelection()) return;
                          setSelectedIndex(index);
                          handleThreadClick(thread);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-github-border pt-4 text-center text-xs text-github-text-secondary">
                  {selectedIndex + 1} of {sortedThreads.length} threads
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
