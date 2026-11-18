import { describe, expect, it } from 'vitest';

import type { DiffCommentThread } from '../types/diff';

import { mergeCommentThreads } from './commentImports';
import {
  addReply,
  matchesCommentFilter,
  isUnreadBy,
  markRead,
  reopenThread,
  resolveThread,
  setAgentStatus,
} from './commentState';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:01:00.000Z';
const T2 = '2026-01-01T00:02:00.000Z';

const thread = (): DiffCommentThread => ({
  id: 't',
  filePath: 'a.ts',
  createdAt: T0,
  updatedAt: T0,
  position: { side: 'new', line: 1 },
  messages: [
    { id: 'm1', body: 'Why?', author: 'User', createdAt: T0, updatedAt: T0 },
    { id: 'm2', body: 'Because', author: 'Claude', createdAt: T0, updatedAt: T0 },
  ],
});

describe('commentState', () => {
  it('counts the author as having read their own message', () => {
    const [mine, theirs] = thread().messages;
    expect(isUnreadBy(mine!, 'User')).toBe(false);
    expect(isUnreadBy(theirs!, 'User')).toBe(true);
    expect(matchesCommentFilter(thread(), 'unread')).toBe(true);
    expect(matchesCommentFilter(markRead(thread(), 'User', T1), 'unread')).toBe(false);
  });

  it('treats a message without an author as the user’s', () => {
    const t = thread();
    t.messages[0] = { ...t.messages[0]!, author: undefined };
    expect(setAgentStatus(t, 'Claude', 'seen', T1).messages[0]?.status?.Claude?.state).toBe('seen');
  });

  it('moves agent status forward only and skips the agent’s own messages', () => {
    const working = setAgentStatus(thread(), 'Claude', 'working', T1);
    const back = setAgentStatus(working, 'Claude', 'seen', T2);
    expect(back).toBe(working);
    expect(back.messages[1]?.status).toBeUndefined();
  });

  it('reopening sets every agent back to open; a user reply on a resolved thread reopens it', () => {
    const resolved = resolveThread(
      setAgentStatus(thread(), 'Claude', 'seen', T0),
      'User',
      undefined,
      T1,
    );
    expect(resolved.resolved).toEqual({ by: 'User', at: T1 });
    expect(reopenThread(resolved, T2).messages[0]?.status?.Claude).toEqual({
      state: 'open',
      at: T2,
    });

    const replied = addReply(
      resolved,
      { id: 'm3', body: 'Again', author: 'User', createdAt: T2, updatedAt: T2 },
      T2,
    );
    expect(replied.resolved).toBeUndefined();
    expect(replied.messages).toHaveLength(3);
  });

  it('waits on an agent until one handled every user message', () => {
    expect(matchesCommentFilter(thread(), 'waiting')).toBe(true);
    const handled = setAgentStatus(thread(), 'Claude', 'handled', T1);
    expect(matchesCommentFilter(handled, 'waiting')).toBe(false);
    expect(matchesCommentFilter(resolveThread(thread(), 'User'), 'waiting')).toBe(false);
    expect(matchesCommentFilter(resolveThread(thread(), 'User'), 'resolved')).toBe(true);
  });

  it('merges read marks and status from both copies, and the newer resolve state', () => {
    const left = markRead(thread(), 'User', T1);
    const right = resolveThread(
      setAgentStatus(thread(), 'Claude', 'working', T1),
      'User',
      'ok',
      T2,
    );

    const [merged] = mergeCommentThreads([left], [right]).threads;
    expect(merged?.messages[1]?.readBy).toEqual({ User: T1 });
    expect(merged?.messages[0]?.status?.Claude?.state).toBe('working');
    expect(merged?.resolved?.note).toBe('ok');
  });
});
