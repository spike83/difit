import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit2,
  Flag,
  MessageSquare,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { type AgentStatus, type CommentThread, type DiffCommentMessage } from '../../types/diff';
import { authorOf, isUnreadBy, USER_AUTHOR } from '../../utils/commentState';
import { isFileCommentLine } from '../../utils/fileComments';
import { useCommentActions } from '../contexts/CommentActionsContext';
import { useClickOutside } from '../hooks/useClickOutside';
import { copyTextToClipboard } from '../utils/clipboard';

import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm } from './CommentForm';
import type { AppearanceSettings } from './SettingsModal';

const STALLED_AFTER_MS = 30 * 60 * 1000;
const READ_AFTER_MS = 1500;

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

function AgentStatusChip({ agent, status }: { agent: string; status: AgentStatus }) {
  const now = useNow(60000, status.state === 'working');
  if (status.state === 'open') return null;
  const elapsed = now - Date.parse(status.at);
  const stalled = status.state === 'working' && elapsed > STALLED_AFTER_MS;
  const label =
    status.state === 'seen'
      ? `👁 ${agent} seen`
      : status.state === 'working'
        ? `⏳ ${agent} working ${formatElapsed(Math.max(0, elapsed))}${stalled ? ' · stalled?' : ''}`
        : `✓ ${agent} handled`;
  return (
    <span
      data-agent-status={status.state}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${
        stalled
          ? 'border-orange-500 text-orange-600'
          : 'border-github-border text-github-text-secondary'
      }`}
      title={`${agent}: ${status.state} since ${new Date(status.at).toLocaleString()}`}
    >
      {label}
    </span>
  );
}

/** Calls onRead once the element was at least half visible for a while in a focused tab. */
function useReadOnView(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  onRead: () => void,
) {
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (visible && document.hasFocus() && document.visibilityState === 'visible') {
        timer = setTimeout(() => onReadRef.current(), READ_AFTER_MS);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
        update();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(element);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled, ref]);
}

interface ThreadMessageItemProps {
  message: DiffCommentMessage;
  onRead?: () => void;
  showAction?: boolean;
  isRootMessage?: boolean;
  showAuthorBadge: boolean;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  originalCode?: string;
  onUpdate: (newBody: string) => void;
  onResolveOrDelete: () => void;
  actionLabel: string;
  confirmPrompt?: string;
  onClick?: (e: React.MouseEvent) => void;
}

function ThreadMessageItem({
  message,
  isRootMessage = false,
  showAuthorBadge,
  syntaxTheme,
  filename,
  originalCode,
  onUpdate,
  onResolveOrDelete,
  actionLabel,
  confirmPrompt,
  onClick,
  onRead,
  showAction = true,
}: ThreadMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const isUnread = isUnreadBy(message, USER_AUTHOR);
  useReadOnView(itemRef, isUnread && Boolean(onRead), () => onRead?.());
  const statuses = authorOf(message) === USER_AUTHOR ? Object.entries(message.status ?? {}) : [];
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmContainerRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const showAuthorHeader = showAuthorBadge && Boolean(message.author);
  const isUserAuthoredMessage = message.author?.trim() === 'User';

  useClickOutside(confirmContainerRef, () => setIsConfirming(false), isConfirming);

  useEffect(() => {
    if (!isConfirming) return;

    confirmButtonRef.current?.focus();

    // Capture phase so Escape only cancels the confirmation and never reaches
    // surrounding Escape handlers (e.g. the CommentsListModal close hotkey).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsConfirming(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isConfirming]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = (nextBody: string) => {
    if (nextBody !== message.body) {
      onUpdate(nextBody);
    }
    setIsEditing(false);
    return Promise.resolve();
  };

  return (
    <div
      ref={itemRef}
      data-unread={isUnread ? 'true' : undefined}
      className={`${isEditing ? '' : 'flex min-w-0 items-start gap-3'} ${
        isUnread ? '-mx-1 rounded bg-blue-500/10 px-1' : ''
      }`}
      onClick={onClick}
    >
      {!isEditing ? (
        <>
          {isUnread && (
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"
              title="Unread"
              aria-label="Unread"
            />
          )}
          <div className="min-w-0 flex-1">
            {showAuthorHeader && (
              <div className="mb-2 flex min-w-0 items-center gap-2 pr-2 text-xs text-github-text-secondary">
                <span className="inline-flex items-center rounded-full border border-github-border bg-github-bg-primary px-2 py-0.5 text-[11px] font-medium text-github-text-primary">
                  {message.author}
                </span>
              </div>
            )}

            <CommentBodyRenderer
              body={message.body}
              originalCode={originalCode}
              filename={filename}
              syntaxTheme={syntaxTheme}
            />
            {statuses.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {statuses.map(([agent, status]) => (
                  <AgentStatusChip key={agent} agent={agent} status={status} />
                ))}
              </div>
            )}
          </div>
          {showAction &&
            (isRootMessage || isUserAuthoredMessage) &&
            (isConfirming ? (
              <div
                ref={confirmContainerRef}
                className="flex shrink-0 items-center gap-1.5 pt-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="whitespace-nowrap text-xs text-github-text-secondary">
                  {confirmPrompt}
                </span>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                    onResolveOrDelete();
                  }}
                  className={`whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs font-medium transition-all hover:bg-github-bg-primary ${
                    isRootMessage ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                >
                  {isRootMessage ? 'Resolve' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                  }}
                  className="whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs text-github-text-primary transition-all hover:bg-github-bg-primary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-start gap-2 pt-0.5">
                {isUserAuthoredMessage && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary"
                    title="Edit message"
                  >
                    <Edit2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmPrompt) {
                      setIsConfirming(true);
                      return;
                    }
                    onResolveOrDelete();
                  }}
                  className={`rounded border border-github-border bg-github-bg-tertiary p-1.5 transition-all hover:bg-github-bg-primary ${
                    isRootMessage ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                  title={actionLabel}
                  aria-label={actionLabel}
                >
                  {isRootMessage ? <Check size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
        </>
      ) : (
        <CommentForm
          onSubmit={handleSaveEdit}
          onCancel={handleCancelEdit}
          selectedCode={originalCode}
          syntaxTheme={syntaxTheme}
          filename={filename}
          initialValue={message.body}
          embedded={true}
          title="Edit comment"
          submitLabel="Save"
          placeholder="Edit your message..."
        />
      )}
    </div>
  );
}

interface CommentThreadCardProps {
  thread: CommentThread;
  showAuthorBadges?: boolean;
  confirmRootAction?: boolean;
  onGeneratePrompt: (thread: CommentThread) => string;
  onRemoveThread: (threadId: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  onClick?: (e: React.MouseEvent) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentThreadCard({
  thread,
  showAuthorBadges = false,
  confirmRootAction = true,
  onGeneratePrompt,
  onRemoveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  onClick,
  syntaxTheme,
}: CommentThreadCardProps) {
  const { reopenThread, deleteThread, toggleTodo, markRead } = useCommentActions();
  const isResolved = Boolean(thread.resolved);
  const [isCopied, setIsCopied] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(isResolved);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  // Resolving folds the thread away; reopening or a todo brings it back.
  useEffect(() => {
    setIsCollapsed(isResolved);
  }, [isResolved]);
  useEffect(() => {
    if (thread.todo) setIsCollapsed(false);
  }, [thread.todo]);
  const handleRead = (messageId: string) =>
    markRead && !isResolved ? () => markRead(thread.id, [messageId]) : undefined;
  const unreadCount = thread.messages.filter((message) => isUnreadBy(message, USER_AUTHOR)).length;
  const lineLabel = Array.isArray(thread.line)
    ? `${thread.line[0]}-${thread.line[1]}`
    : thread.line;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed((prev) => !prev);
  };

  const handleCopyThread = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const prompt = onGeneratePrompt(thread);
      await copyTextToClipboard(prompt);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy thread prompt:', error);
    }
  };

  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  return (
    <div
      id={`comment-thread-${thread.id}`}
      data-resolved={isResolved ? 'true' : undefined}
      data-todo={thread.todo ? 'true' : undefined}
      className={`rounded-md border border-l-4 bg-github-bg-tertiary p-3 shadow-sm transition-all ${
        isResolved
          ? 'border-github-border border-l-github-text-muted opacity-70'
          : thread.todo
            ? 'border-orange-500/60 border-l-orange-500'
            : 'border-yellow-600/50 border-l-yellow-400'
      } ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <div className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-3'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-github-text-secondary">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            title={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            className="shrink-0 rounded p-0.5 text-github-text-secondary transition-colors hover:bg-github-bg-primary hover:text-github-text-primary"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span
            className="font-mono px-1 py-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap"
            style={{
              backgroundColor: 'var(--color-yellow-path-bg)',
              color: 'var(--color-yellow-path-text)',
            }}
          >
            {isFileCommentLine(thread.line) ? thread.file : `${thread.file}:${lineLabel}`}
          </span>
          {thread.isOutdated && (
            <span
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-github-text-muted px-2 text-[10px] font-medium text-github-text-muted"
              title="Code has changed since this comment was made"
              aria-label="Outdated comment"
            >
              Outdated
            </span>
          )}
          {isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="Expand thread"
            >
              <span className="min-w-0 flex-1 truncate text-github-text-secondary">
                {rootMessage.body.split('\n')[0]}
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-github-text-muted"
                aria-label={`${thread.messages.length} messages in thread`}
              >
                <MessageSquare size={12} />
                {thread.messages.length}
              </span>
              {unreadCount > 0 && !isResolved && (
                <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Unread" />
              )}
            </button>
          )}
        </div>
        {thread.resolved && (
          <span
            className="min-w-0 shrink truncate text-xs text-github-text-muted"
            title={thread.resolved.note}
          >
            {thread.resolved.by === USER_AUTHOR ? 'Resolved' : `Resolved by ${thread.resolved.by}`}
            {thread.resolved.note ? `: ${thread.resolved.note}` : ''}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {toggleTodo && !isResolved && (
            <button
              type="button"
              onClick={() => toggleTodo(thread.id)}
              aria-pressed={Boolean(thread.todo)}
              className={`rounded p-1 transition-colors hover:bg-github-bg-primary ${
                thread.todo ? 'text-orange-500' : 'text-github-text-muted'
              }`}
              title={
                thread.todo
                  ? `Todo${thread.todo.by === USER_AUTHOR ? '' : ` (set by ${thread.todo.by})`}: click to clear (t)`
                  : 'Mark as todo (t)'
              }
            >
              <Flag size={13} fill={thread.todo ? 'currentColor' : 'none'} />
            </button>
          )}
          {isResolved && reopenThread && (
            <button
              type="button"
              onClick={() => reopenThread(thread.id)}
              className="inline-flex items-center gap-1 rounded border border-github-border px-2 py-0.5 text-xs text-github-text-primary hover:bg-github-bg-primary"
              title="Reopen thread"
            >
              <RotateCcw size={12} /> Reopen
            </button>
          )}
          {isResolved &&
            deleteThread &&
            (isConfirmingDelete ? (
              <>
                <button
                  type="button"
                  onClick={() => deleteThread(thread.id)}
                  className="rounded border border-github-border px-2 py-0.5 text-xs text-github-danger hover:bg-github-bg-primary"
                >
                  Delete permanently
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="rounded border border-github-border px-2 py-0.5 text-xs text-github-text-primary hover:bg-github-bg-primary"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                className="rounded p-1 text-github-danger hover:bg-github-bg-primary"
                title="Delete thread permanently"
                aria-label="Delete thread permanently"
              >
                <Trash2 size={12} />
              </button>
            ))}
        </div>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyThread}
              className="whitespace-nowrap rounded px-2 py-1 text-xs transition-all"
              style={{
                backgroundColor: 'var(--color-yellow-btn-bg)',
                color: 'var(--color-yellow-btn-text)',
                border: '1px solid var(--color-yellow-btn-border)',
              }}
              title="Copy thread prompt for AI coding agent"
            >
              <span className="inline-flex items-center gap-1">
                <Copy size={12} />
                {isCopied ? 'Copied!' : 'Copy Prompt'}
              </span>
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="space-y-3">
          <ThreadMessageItem
            message={rootMessage}
            isRootMessage={true}
            showAuthorBadge={showAuthorBadges}
            syntaxTheme={syntaxTheme}
            filename={thread.file}
            originalCode={thread.codeContent}
            onUpdate={(newBody) => onUpdateMessage(thread.id, rootMessage.id, newBody)}
            onResolveOrDelete={() => onRemoveThread(thread.id)}
            actionLabel="Resolve thread"
            confirmPrompt={confirmRootAction ? 'Resolve?' : undefined}
            showAction={!isResolved}
            onRead={handleRead(rootMessage.id)}
          />

          {thread.messages.slice(1).map((message) => (
            <div key={message.id} className="ml-4 border-l border-github-border pl-3">
              <ThreadMessageItem
                message={message}
                showAuthorBadge={showAuthorBadges}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                originalCode={thread.codeContent}
                onUpdate={(newBody) => onUpdateMessage(thread.id, message.id, newBody)}
                onResolveOrDelete={() => onRemoveMessage(thread.id, message.id)}
                actionLabel="Delete reply"
                confirmPrompt="Delete?"
                onRead={handleRead(message.id)}
              />
            </div>
          ))}

          <div
            className="ml-4 border-l border-github-border pl-3"
            onClick={(e) => e.stopPropagation()}
          >
            {isReplying ? (
              <CommentForm
                onSubmit={async (body) => {
                  await onReplyToThread(thread.id, body);
                  setIsReplying(false);
                }}
                onCancel={() => setIsReplying(false)}
                selectedCode={thread.codeContent}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                embedded={true}
                title="Reply to thread"
                submitLabel="Reply"
                placeholder="Write a reply..."
              />
            ) : (
              <button
                type="button"
                data-reply-trigger="true"
                onFocus={() => setIsReplying(true)}
                onClick={() => setIsReplying(true)}
                className="w-full cursor-text rounded border border-github-border bg-github-bg-secondary px-3 py-1.5 text-left text-sm text-github-text-muted transition-colors hover:border-github-text-secondary"
              >
                Write a reply...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
