import type {
  AgentState,
  AgentStatus,
  DiffCommentMessage,
  DiffCommentThread,
  ThreadMark,
} from '../types/diff.js';

// Messages from the browser carry this author; older ones carry none.
export const USER_AUTHOR = 'User';

const STATE_RANK: Record<AgentState, number> = { open: 0, seen: 1, working: 2, handled: 3 };

export const isAgentState = (value: unknown): value is AgentState =>
  typeof value === 'string' && value in STATE_RANK;

export const authorOf = (message: DiffCommentMessage): string =>
  message.author?.trim() || USER_AUTHOR;

export const isUnreadBy = (message: DiffCommentMessage, reader: string): boolean =>
  authorOf(message) !== reader && !message.readBy?.[reader];

const now = () => new Date().toISOString();

export function resolveThread(
  thread: DiffCommentThread,
  by: string,
  note?: string,
  at = now(),
): DiffCommentThread {
  const resolved = note ? { by, at, note } : { by, at };
  const handled = by === USER_AUTHOR ? thread : setAgentStatus(thread, by, 'handled', at);
  return { ...handled, resolved, todo: undefined, stateAt: at };
}

/** Back to active; every agent has to look at the thread again. */
export function reopenThread(thread: DiffCommentThread, at = now()): DiffCommentThread {
  return {
    ...thread,
    resolved: undefined,
    stateAt: at,
    messages: thread.messages.map((message) =>
      message.status
        ? {
            ...message,
            status: Object.fromEntries(
              Object.keys(message.status).map((agent) => [agent, { state: 'open', at }]),
            ),
          }
        : message,
    ),
  };
}

export function setTodo(
  thread: DiffCommentThread,
  todo: ThreadMark | undefined,
  at = now(),
): DiffCommentThread {
  return { ...thread, todo, stateAt: at };
}

/** Append a reply; a reply to a resolved thread reopens it, and the author has handled the rest. */
export function addReply(
  thread: DiffCommentThread,
  message: DiffCommentMessage,
  at = now(),
): DiffCommentThread {
  const active = thread.resolved ? reopenThread(thread, at) : thread;
  const withReply = { ...active, updatedAt: at, messages: [...active.messages, message] };
  const author = authorOf(message);
  return author === USER_AUTHOR ? withReply : setAgentStatus(withReply, author, 'handled', at);
}

/** Move the agent forward on every message it did not write; never moves back. */
export function setAgentStatus(
  thread: DiffCommentThread,
  agent: string,
  state: AgentState,
  at = now(),
  messageIds?: readonly string[],
): DiffCommentThread {
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (authorOf(message) === agent || (messageIds && !messageIds.includes(message.id))) {
      return message;
    }
    const current = message.status?.[agent];
    if (current && STATE_RANK[current.state] >= STATE_RANK[state]) {
      return message;
    }
    changed = true;
    return { ...message, status: { ...message.status, [agent]: { state, at } } };
  });
  return changed ? { ...thread, messages } : thread;
}

export function markRead(
  thread: DiffCommentThread,
  reader: string,
  at = now(),
  messageIds?: readonly string[],
): DiffCommentThread {
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (!isUnreadBy(message, reader) || (messageIds && !messageIds.includes(message.id))) {
      return message;
    }
    changed = true;
    return { ...message, readBy: { ...message.readBy, [reader]: at } };
  });
  return changed ? { ...thread, messages } : thread;
}

// Merging two copies of the same message or thread (an agent and the browser wrote at once).

export function mergeReadBy(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!left || !right) return left ?? right;
  const merged = { ...left };
  for (const [reader, at] of Object.entries(right)) {
    if (!merged[reader] || at < merged[reader]) merged[reader] = at;
  }
  return merged;
}

export function mergeStatus(
  left: Record<string, AgentStatus> | undefined,
  right: Record<string, AgentStatus> | undefined,
): Record<string, AgentStatus> | undefined {
  if (!left || !right) return left ?? right;
  const merged = { ...left };
  for (const [agent, status] of Object.entries(right)) {
    const current = merged[agent];
    if (!current || status.at > current.at) merged[agent] = status;
  }
  return merged;
}

/** resolved/todo of whichever copy changed them last. */
export function pickThreadState(
  left: DiffCommentThread,
  right: DiffCommentThread,
): Pick<DiffCommentThread, 'resolved' | 'todo' | 'stateAt'> {
  const newer = (right.stateAt ?? '') > (left.stateAt ?? '') ? right : left;
  return { resolved: newer.resolved, todo: newer.todo, stateAt: newer.stateAt };
}

// Filters of the comments list; 'open' is every thread not resolved.
export type CommentFilter = 'open' | 'unread' | 'todo' | 'waiting' | 'resolved';

export const COMMENT_FILTERS: { id: CommentFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'unread', label: 'Unread' },
  { id: 'todo', label: 'Todos' },
  { id: 'waiting', label: 'Waiting on agent' },
  { id: 'resolved', label: 'Resolved' },
];

/** A message of the user that no agent has handled yet. */
const isWaitingOnAgent = (message: DiffCommentMessage): boolean =>
  authorOf(message) === USER_AUTHOR &&
  !Object.values(message.status ?? {}).some((status) => status.state === 'handled');

export function matchesCommentFilter(
  thread: Pick<DiffCommentThread, 'messages' | 'resolved' | 'todo'>,
  filter: CommentFilter,
): boolean {
  if (filter === 'resolved') return Boolean(thread.resolved);
  if (thread.resolved) return false;
  switch (filter) {
    case 'unread':
      return thread.messages.some((message) => isUnreadBy(message, USER_AUTHOR));
    case 'todo':
      return Boolean(thread.todo);
    case 'waiting':
      return thread.messages.some(isWaitingOnAgent);
    default:
      return true;
  }
}
