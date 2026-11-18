import { useState, useEffect, useCallback } from 'react';

import {
  type BaseMode,
  type CommentImport,
  type CommentThread,
  type DiffContextStorage,
  type DiffCommentThread,
  type DiffSide,
  type LegacyDiffComment,
} from '../../types/diff';
import {
  type CommentPromptDiffContext,
  formatCommentThreadPrompt,
  formatAllCommentThreadsPrompt,
} from '../../utils/commentFormatting';
import { createId } from '../../utils/createId';
import { mergeCommentImports } from '../../utils/commentImports';
import {
  addReply,
  markRead,
  reopenThread as reopen,
  resolveThread as resolve,
  DIFIT_AUTHOR,
  setTodo,
  USER_AUTHOR,
} from '../../utils/commentState';
import { FILE_COMMENT_LINE } from '../../utils/fileComments';
import { storageService } from '../services/StorageService';
import { getLanguageFromPath } from '../utils/diffUtils';

interface AddThreadParams {
  filePath: string;
  body: string;
  side: DiffSide;
  line: number | { start: number; end: number };
  codeSnapshot?: DiffCommentThread['codeSnapshot'];
}

interface ReplyToThreadParams {
  threadId: string;
  body: string;
}

interface UseDiffCommentsReturn {
  hasLoadedComments: boolean;
  comments: LegacyDiffComment[];
  threads: DiffCommentThread[];
  replaceThreads: (threads: DiffCommentThread[]) => void;
  addComment: (params: AddThreadParams) => LegacyDiffComment;
  addThread: (params: AddThreadParams) => DiffCommentThread;
  removeComment: (commentId: string) => void;
  replyToThread: (params: ReplyToThreadParams) => void;
  /** Deletes for good; resolveThread keeps the thread as history. */
  removeThread: (threadId: string) => void;
  resolveThread: (threadId: string) => void;
  reopenThread: (threadId: string) => void;
  toggleTodo: (threadId: string) => void;
  markMessagesRead: (threadId: string, messageIds: string[]) => void;
  /** difit's own notes on whole files, added to its open note thread of the file if there is one. */
  addFileNotes: (notes: { filePath: string; body: string }[]) => void;
  updateComment: (commentId: string, newBody: string) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  updateMessage: (threadId: string, messageId: string, newBody: string) => void;
  clearAllComments: (options?: { resetAppliedCommentImportIds?: boolean }) => void;
  applyCommentImports: (imports: CommentImport[], importId: string) => string[];
  generatePrompt: (commentId: string) => string;
  generateThreadPrompt: (threadId: string) => string;
  generateAllCommentsPrompt: (context?: CommentPromptDiffContext) => string;
}

function normalizeThread(thread: DiffCommentThread): CommentThread {
  return {
    id: thread.id,
    file: thread.filePath,
    line:
      typeof thread.position.line === 'number'
        ? thread.position.line
        : ([thread.position.line.start, thread.position.line.end] as [number, number]),
    side: thread.position.side,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    codeContent: thread.codeSnapshot?.content,
    messages: thread.messages,
    resolved: thread.resolved,
    todo: thread.todo,
  };
}

function normalizeRootComment(thread: DiffCommentThread): LegacyDiffComment | null {
  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  return {
    id: thread.id,
    filePath: thread.filePath,
    body: rootMessage.body,
    author: rootMessage.author,
    createdAt: rootMessage.createdAt,
    updatedAt: rootMessage.updatedAt,
    position: thread.position,
    codeSnapshot: thread.codeSnapshot,
  };
}

export function useDiffComments(
  baseCommitish?: string,
  targetCommitish?: string,
  currentCommitHash?: string,
  branchToHash?: Map<string, string>,
  repositoryId?: string,
  baseMode?: BaseMode,
): UseDiffCommentsReturn {
  const [threads, setThreads] = useState<DiffCommentThread[]>([]);
  const [hasLoadedComments, setHasLoadedComments] = useState(false);

  const loadDiffContextData = useCallback(() => {
    if (!baseCommitish || !targetCommitish) {
      return null;
    }

    return storageService.getDiffContextData(
      baseCommitish,
      targetCommitish,
      currentCommitHash,
      branchToHash,
      repositoryId,
      baseMode,
    );
  }, [baseCommitish, targetCommitish, currentCommitHash, branchToHash, repositoryId, baseMode]);

  const createEmptyDiffContext = useCallback((): DiffContextStorage | null => {
    if (!baseCommitish || !targetCommitish) {
      return null;
    }

    const now = new Date().toISOString();
    return {
      version: 2,
      baseCommitish,
      targetCommitish,
      baseMode,
      createdAt: now,
      lastModifiedAt: now,
      threads: [],
      viewedFiles: [],
      appliedCommentImportIds: [],
    };
  }, [baseCommitish, targetCommitish, baseMode]);

  useEffect(() => {
    if (!baseCommitish || !targetCommitish) {
      setThreads([]);
      setHasLoadedComments(false);
      return;
    }

    const loadedThreads =
      loadDiffContextData()?.threads ||
      storageService.getCommentThreads(
        baseCommitish,
        targetCommitish,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
    setThreads(loadedThreads);
    setHasLoadedComments(true);
  }, [
    baseCommitish,
    targetCommitish,
    currentCommitHash,
    branchToHash,
    repositoryId,
    baseMode,
    loadDiffContextData,
  ]);

  const saveThreads = useCallback(
    (newThreads: DiffCommentThread[]) => {
      if (!baseCommitish || !targetCommitish) return;

      storageService.saveCommentThreads(
        baseCommitish,
        targetCommitish,
        newThreads,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads(newThreads);
      setHasLoadedComments(true);
    },
    [baseCommitish, targetCommitish, currentCommitHash, branchToHash, repositoryId, baseMode],
  );

  const replaceThreads = useCallback(
    (newThreads: DiffCommentThread[]) => {
      saveThreads(newThreads);
    },
    [saveThreads],
  );

  const addThread = useCallback(
    (params: AddThreadParams): DiffCommentThread => {
      const now = new Date().toISOString();
      const threadId = createId();
      const newThread: DiffCommentThread = {
        id: threadId,
        filePath: params.filePath,
        createdAt: now,
        updatedAt: now,
        position: {
          side: params.side,
          line: params.line,
        },
        codeSnapshot: params.codeSnapshot || {
          content: '',
          language: getLanguageFromPath(params.filePath),
        },
        messages: [
          {
            id: threadId,
            body: params.body,
            author: 'User',
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      const newThreads = [...threads, newThread];
      saveThreads(newThreads);
      return newThread;
    },
    [saveThreads, threads],
  );

  const addComment = useCallback(
    (params: AddThreadParams): LegacyDiffComment => {
      const thread = addThread(params);
      const rootComment = normalizeRootComment(thread);
      if (!rootComment) {
        throw new Error('Failed to create root comment');
      }
      return rootComment;
    },
    [addThread],
  );

  const replyToThread = useCallback(
    ({ threadId, body }: ReplyToThreadParams) => {
      const now = new Date().toISOString();
      const reply = { id: createId(), body, author: USER_AUTHOR, createdAt: now, updatedAt: now };
      // Replying counts as having read the thread.
      const newThreads = threads.map((thread) =>
        thread.id === threadId ? markRead(addReply(thread, reply, now), USER_AUTHOR, now) : thread,
      );
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const updateThread = useCallback(
    (threadId: string, change: (thread: DiffCommentThread) => DiffCommentThread) => {
      let changed = false;
      const newThreads = threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        const next = change(thread);
        changed ||= next !== thread;
        return next;
      });
      if (changed) saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const resolveThread = useCallback(
    (threadId: string) => updateThread(threadId, (thread) => resolve(thread, USER_AUTHOR)),
    [updateThread],
  );

  const reopenThread = useCallback(
    (threadId: string) => updateThread(threadId, (thread) => reopen(thread)),
    [updateThread],
  );

  const toggleTodo = useCallback(
    (threadId: string) =>
      updateThread(threadId, (thread) =>
        setTodo(
          thread,
          thread.todo ? undefined : { by: USER_AUTHOR, at: new Date().toISOString() },
        ),
      ),
    [updateThread],
  );

  const addFileNotes = useCallback(
    (notes: { filePath: string; body: string }[]) => {
      if (notes.length === 0) return;
      let newThreads = threads;
      for (const { filePath, body } of notes) {
        const now = new Date().toISOString();
        const message = {
          id: createId(),
          body,
          author: DIFIT_AUTHOR,
          createdAt: now,
          updatedAt: now,
        };
        const noteThread = newThreads.find(
          (thread) =>
            !thread.resolved &&
            thread.filePath === filePath &&
            thread.position.line === FILE_COMMENT_LINE &&
            thread.messages[0]?.author === DIFIT_AUTHOR,
        );
        newThreads = noteThread
          ? newThreads.map((thread) =>
              thread === noteThread ? addReply(thread, message, now) : thread,
            )
          : [
              ...newThreads,
              {
                id: message.id,
                filePath,
                createdAt: now,
                updatedAt: now,
                position: { side: 'new', line: FILE_COMMENT_LINE },
                messages: [message],
              },
            ];
      }
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const markMessagesRead = useCallback(
    (threadId: string, messageIds: string[]) =>
      updateThread(threadId, (thread) =>
        markRead(thread, USER_AUTHOR, new Date().toISOString(), messageIds),
      ),
    [updateThread],
  );

  const removeThread = useCallback(
    (threadId: string) => {
      const newThreads = threads.filter((thread) => thread.id !== threadId);
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const removeComment = useCallback(
    (commentId: string) => {
      removeThread(commentId);
    },
    [removeThread],
  );

  const removeMessage = useCallback(
    (threadId: string, messageId: string) => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) return;

      const targetIndex = thread.messages.findIndex((message) => message.id === messageId);
      if (targetIndex < 0) {
        return;
      }

      if (targetIndex === 0) {
        removeThread(threadId);
        return;
      }

      const now = new Date().toISOString();
      const newThreads = threads.map((item) =>
        item.id === threadId
          ? {
              ...item,
              updatedAt: now,
              messages: item.messages.filter((message) => message.id !== messageId),
            }
          : item,
      );
      saveThreads(newThreads);
    },
    [removeThread, saveThreads, threads],
  );

  const updateMessage = useCallback(
    (threadId: string, messageId: string, newBody: string) => {
      const now = new Date().toISOString();
      const newThreads = threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: now,
              messages: thread.messages.map((message) =>
                message.id === messageId ? { ...message, body: newBody, updatedAt: now } : message,
              ),
            }
          : thread,
      );
      saveThreads(newThreads);
    },
    [saveThreads, threads],
  );

  const updateComment = useCallback(
    (commentId: string, newBody: string) => {
      updateMessage(commentId, commentId, newBody);
    },
    [updateMessage],
  );

  const clearAllComments = useCallback(() => {
    saveThreads([]);
  }, [saveThreads]);

  const clearAllCommentsWithOptions = useCallback(
    (options?: { resetAppliedCommentImportIds?: boolean }) => {
      if (!options?.resetAppliedCommentImportIds) {
        clearAllComments();
        return;
      }

      const existingData = loadDiffContextData() || createEmptyDiffContext();
      if (!existingData || !baseCommitish || !targetCommitish) {
        return;
      }

      const nextData: DiffContextStorage = {
        ...existingData,
        threads: [],
        appliedCommentImportIds: [],
      };

      storageService.saveDiffContextData(
        baseCommitish,
        targetCommitish,
        nextData,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads([]);
    },
    [
      baseCommitish,
      targetCommitish,
      branchToHash,
      clearAllComments,
      createEmptyDiffContext,
      currentCommitHash,
      loadDiffContextData,
      repositoryId,
      baseMode,
    ],
  );

  const applyCommentImports = useCallback(
    (imports: CommentImport[], importId: string): string[] => {
      if (!baseCommitish || !targetCommitish || imports.length === 0 || importId.length === 0) {
        return [];
      }

      const existingData = loadDiffContextData() || createEmptyDiffContext();
      if (!existingData) {
        return [];
      }

      if (existingData.appliedCommentImportIds.includes(importId)) {
        setThreads(existingData.threads);
        return [];
      }

      const merged = mergeCommentImports(existingData.threads, imports);
      const nextData: DiffContextStorage = {
        ...existingData,
        threads: merged.threads,
        appliedCommentImportIds: [...existingData.appliedCommentImportIds, importId],
      };

      storageService.saveDiffContextData(
        baseCommitish,
        targetCommitish,
        nextData,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setThreads(merged.threads);
      return merged.warnings;
    },
    [
      baseCommitish,
      targetCommitish,
      branchToHash,
      createEmptyDiffContext,
      currentCommitHash,
      loadDiffContextData,
      repositoryId,
      baseMode,
    ],
  );

  const generateThreadPrompt = useCallback(
    (threadId: string): string => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) return '';

      return formatCommentThreadPrompt(normalizeThread(thread));
    },
    [threads],
  );

  const generatePrompt = useCallback(
    (commentId: string): string => {
      return generateThreadPrompt(commentId);
    },
    [generateThreadPrompt],
  );

  const generateAllCommentsPrompt = useCallback(
    (context?: CommentPromptDiffContext): string => {
      return formatAllCommentThreadsPrompt(
        threads.filter((thread) => !thread.resolved).map(normalizeThread),
        context,
      );
    },
    [threads],
  );

  const comments = threads
    .map((thread) => normalizeRootComment(thread))
    .filter((comment): comment is LegacyDiffComment => comment !== null);

  return {
    hasLoadedComments,
    comments,
    threads,
    replaceThreads,
    addComment,
    addThread,
    removeComment,
    replyToThread,
    removeThread,
    resolveThread,
    reopenThread,
    toggleTodo,
    markMessagesRead,
    addFileNotes,
    updateComment,
    removeMessage,
    updateMessage,
    clearAllComments: clearAllCommentsWithOptions,
    applyCommentImports,
    generatePrompt,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  };
}
