import {
  Columns,
  AlignLeft,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Keyboard,
  MessageSquare,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import {
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type DiffViewMode,
  type DiffSide,
  type LineNumber,
  type CommentThread,
  type RevisionsResponse,
} from '../types/diff';
import { DEFAULT_DIFF_VIEW_MODE, normalizeDiffViewMode } from '../utils/diffMode';
import { mergeCommentThreads } from '../utils/commentImports';
import { type CommentFilter, matchesCommentFilter } from '../utils/commentState';
import { describeViewedFileChange } from '../utils/viewedFileChanges';
import { isFileCommentLine } from '../utils/fileComments';
import {
  createDiffSelection,
  diffSelectionsEqual,
  getDiffSelectionKey,
  normalizeBaseMode,
} from '../utils/diffSelection';

import { Checkbox } from './components/Checkbox';
import { CommentsDropdown } from './components/CommentsDropdown';
import { CommentsListModal } from './components/CommentsListModal';
import { DiffQuickMenu } from './components/DiffQuickMenu';
import { DiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { GitHubIcon } from './components/GitHubIcon';
import { HelpModal } from './components/HelpModal';
import { Logo } from './components/Logo';
import { ReloadButton } from './components/ReloadButton';
import { RevisionDetailModal } from './components/RevisionDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SparkleAnimation } from './components/SparkleAnimation';
import { type CommentActions, CommentActionsProvider } from './contexts/CommentActionsContext';
import { WordHighlightProvider } from './contexts/WordHighlightContext';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';
import { useDiffComments } from './hooks/useDiffComments';
import { useExpandedLines, type MergedChunk } from './hooks/useExpandedLines';
import { useFileWatch } from './hooks/useFileWatch';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useLazyDiffRendering } from './hooks/useLazyDiffRendering';
import { type ViewedFileChange, useViewedFiles } from './hooks/useViewedFiles';
import { useViewport } from './hooks/useViewport';
import { fetchClientSettings, saveClientSettings } from './services/userSettings';
import { hasMultipleCommentAuthors } from './utils/commentAuthors';
import { copyTextToClipboard } from './utils/clipboard';
import { getFileElementId } from './utils/domUtils';
import { findCommentPosition } from './utils/navigation/positionHelpers';
import { resolveEventSourceUrl } from './utils/eventSourceUrl';
import {
  EMPTY_MERGED_CHUNKS_STATE,
  buildMergedChunksState,
  chunksHaveExpandedLines,
  chunksHaveHiddenLines,
  getMergedChunksForVersion,
} from './utils/mergedChunks';
import { buildFileLineIndex, isThreadOutdated } from './utils/outdatedComments';
import {
  DEFAULT_PREVIEW_MODE,
  parsePreviewMode,
  type PreviewMode,
} from './viewers/PreviewModeTabs';
import { getViewerForFile } from './viewers/registry';

const EMPTY_COMMENT_THREADS: CommentThread[] = [];
const EMPTY_MERGED_CHUNKS: MergedChunk[] = [];
const DIFF_VIEW_MODE_STORAGE_KEY = 'difit.diffViewMode';
const MARKDOWN_PREVIEW_MODE_STORAGE_KEY = 'difit.markdownPreviewMode';
const SIDEBAR_WIDTH_STORAGE_KEY = 'difit.sidebarWidth';
const SIDEBAR_OPEN_STORAGE_KEY = 'difit.sidebarOpen';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;

const parseDiffViewMode = (value: unknown): DiffViewMode | null => {
  switch (value) {
    case 'split':
    case 'side-by-side':
    case 'unified':
    case 'inline':
      return normalizeDiffViewMode(value);
    default:
      return null;
  }
};

const getStoredDiffViewMode = (): DiffViewMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseDiffViewMode(window.localStorage.getItem(DIFF_VIEW_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const getInitialDiffViewMode = () => getStoredDiffViewMode() ?? DEFAULT_DIFF_VIEW_MODE;

const getStoredMarkdownPreviewMode = (): PreviewMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parsePreviewMode(window.localStorage.getItem(MARKDOWN_PREVIEW_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const getInitialMarkdownPreviewMode = () => getStoredMarkdownPreviewMode() ?? DEFAULT_PREVIEW_MODE;

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

const getStoredSidebarWidth = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clampSidebarWidth(parsed);
};

const getInitialSidebarWidth = () => getStoredSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH;

const getStoredSidebarOpen = (): boolean | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
  if (stored === 'true') {
    return true;
  }
  if (stored === 'false') {
    return false;
  }
  return null;
};

const getInitialFileTreeOpen = () => getStoredSidebarOpen() ?? true;

function App() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffDataVersion, setDiffDataVersion] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(getInitialDiffViewMode);
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<PreviewMode>(
    getInitialMarkdownPreviewMode,
  );
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(getInitialFileTreeOpen);
  const [isDragging, setIsDragging] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [hasTriggeredSparkles, setHasTriggeredSparkles] = useState(false);
  const [isCommentsListOpen, setIsCommentsListOpen] = useState(false);
  const [commentsListFilter, setCommentsListFilter] = useState<CommentFilter>('open');
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const collapsedInitializedRef = useRef(false);
  const diffScrollContainerRef = useRef<HTMLElement | null>(null);

  // Revision selector state
  const [revisionOptions, setRevisionOptions] = useState<RevisionsResponse | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<DiffSelection>(
    createDiffSelection('', ''),
  );
  const [resolvedBaseRevision, setResolvedBaseRevision] = useState<string>('');
  const [resolvedTargetRevision, setResolvedTargetRevision] = useState<string>('');
  const hasUserSelectedRevisionRef = useRef(false);
  const currentRequestedBaseModeRef = useRef(selectedRevision.baseMode);
  currentRequestedBaseModeRef.current = diffData?.requestedBaseMode ?? selectedRevision.baseMode;
  const selectedRevisionRef = useRef(selectedRevision);
  selectedRevisionRef.current = selectedRevision;
  const diffRequestIdRef = useRef(0);
  const activeDiffAbortControllerRef = useRef<AbortController | null>(null);
  const resolvedSelection = useMemo<DiffSelection | null>(() => {
    if (!diffData?.baseCommitish || !diffData?.targetCommitish) {
      return null;
    }

    return createDiffSelection(
      diffData.baseCommitish,
      diffData.targetCommitish,
      diffData.requestedBaseMode,
    );
  }, [diffData]);
  const resolvedSelectionKey = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    return getDiffSelectionKey(resolvedSelection);
  }, [resolvedSelection]);

  const { settings, updateSettings } = useAppearanceSettings();
  const { isMobile, isDesktop } = useViewport();

  // New diff-aware comment system
  const {
    hasLoadedComments,
    threads,
    replaceThreads,
    addThread,
    replyToThread,
    removeThread,
    resolveThread,
    reopenThread,
    toggleTodo,
    markMessagesRead,
    addFileNotes,
    removeMessage,
    updateMessage,
    clearAllComments,
    generateThreadPrompt,
    generateAllCommentsPrompt,
  } = useDiffComments(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit, // Using commit as currentCommitHash
    undefined, // branchToHash map - could be populated from server data
    diffData?.repositoryId, // Repository identifier for storage isolation
    resolvedSelection?.baseMode,
  );

  const commentActions = useMemo<CommentActions>(
    () => ({ reopenThread, deleteThread: removeThread, toggleTodo, markRead: markMessagesRead }),
    [markMessagesRead, removeThread, reopenThread, toggleTodo],
  );

  const openCommentsList = useCallback(
    (filter?: CommentFilter) => {
      // Without a filter: the open threads, or the history when every thread is resolved.
      setCommentsListFilter(
        filter ?? (threads.some((thread) => !thread.resolved) ? 'open' : 'resolved'),
      );
      setIsCommentsListOpen(true);
    },
    [threads],
  );

  const showMobileCommentsBar = isMobile && threads.length > 0;
  const commentsContextKey = useMemo(() => {
    if (!resolvedSelectionKey) {
      return null;
    }

    return `${diffData?.repositoryId ?? 'default'}:${resolvedSelectionKey}`;
  }, [diffData?.repositoryId, resolvedSelectionKey]);
  const commentSessionQueryString = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    const params = new URLSearchParams({
      base: resolvedSelection.baseCommitish,
      target: resolvedSelection.targetCommitish,
    });
    if (resolvedSelection.baseMode === 'merge-base') {
      params.set('baseMode', resolvedSelection.baseMode);
    }

    return params.toString();
  }, [resolvedSelection]);
  const getCommentApiUrl = useCallback(
    (path: string) => {
      if (!commentSessionQueryString) {
        return path;
      }
      return `${path}?${commentSessionQueryString}`;
    },
    [commentSessionQueryString],
  );
  const [bootstrappedCommentsKey, setBootstrappedCommentsKey] = useState<string | null>(null);
  const hasBootstrappedComments =
    commentsContextKey !== null && commentsContextKey === bootstrappedCommentsKey;
  const bootstrappingCommentsKeyRef = useRef<string | null>(null);
  const skipNextCommentSyncRef = useRef(false);
  // Last server comment version seen; echoed back as baseVersion so the server can detect concurrent writes.
  const serverCommentVersionRef = useRef<number | null>(null);
  const pendingBootstrapAfterLocalResetRef = useRef(false);

  useEffect(() => {
    if (commentsContextKey !== bootstrappedCommentsKey) {
      skipNextCommentSyncRef.current = false;
    }
  }, [bootstrappedCommentsKey, commentsContextKey]);

  // The server read this selection's comment file, so the browser's copy is only a cache.
  const serverCommentsPersistedRef = useRef(false);
  const fetchServerThreads = useCallback(async (): Promise<DiffCommentThread[]> => {
    const response = await fetch(getCommentApiUrl('/api/comments-json'));
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      version?: number;
      persisted?: boolean;
      threads?: DiffCommentThread[];
    };
    if (typeof payload.version === 'number') {
      serverCommentVersionRef.current = payload.version;
    }
    serverCommentsPersistedRef.current = payload.persisted === true;
    return Array.isArray(payload.threads) ? payload.threads : [];
  }, [getCommentApiUrl]);

  const syncThreadsToServer = useCallback(
    async (nextThreads: DiffCommentThread[]) => {
      const response = await fetch(getCommentApiUrl('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threads: nextThreads,
          baseVersion: serverCommentVersionRef.current ?? undefined,
        }),
      });
      if (!response.ok) {
        return;
      }

      const result = (await response.json()) as {
        version?: number;
        merged?: boolean;
        threads?: DiffCommentThread[];
      };
      if (typeof result.version === 'number') {
        serverCommentVersionRef.current = result.version;
      }
      // Server merged in a concurrent change; adopt it so we don't push a stale set back.
      if (result.merged && Array.isArray(result.threads)) {
        skipNextCommentSyncRef.current = true;
        replaceThreads(result.threads);
      }
    },
    [getCommentApiUrl, replaceThreads],
  );

  // A viewed file that changed gets a note on why it is unviewed again. Notes wait until the
  // comments are loaded, so the server's copy doesn't replace them.
  const [pendingFileNotes, setPendingFileNotes] = useState<{ filePath: string; body: string }[]>(
    [],
  );
  const handleViewedFilesChanged = useCallback((changes: ViewedFileChange[]) => {
    const changedPaths = new Set(changes.map(({ file }) => file.path));
    setCollapsedFiles((prev) => new Set([...prev].filter((path) => !changedPaths.has(path))));
    setPendingFileNotes((prev) => [
      ...prev,
      ...changes.map(({ file, previous }) => ({
        filePath: file.path,
        body: describeViewedFileChange(file, previous),
      })),
    ]);
  }, []);

  // Viewed files management
  const {
    viewedFiles,
    changedSinceViewedFiles,
    hasLoadedInitialViewedFiles,
    toggleFileViewed,
    setFilesViewed,
    clearViewedFiles,
  } = useViewedFiles(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit,
    undefined,
    diffData?.files,
    diffData?.repositoryId, // Repository identifier for storage isolation
    settings.autoViewedPatterns,
    resolvedSelection?.baseMode,
    String(diffData?.ignoreWhitespace ?? false),
    handleViewedFilesChanged,
  );

  // Storage keeps a viewed record for a path even after it leaves the diff
  // (renamed away, or the change reverted), so review progress counts only the
  // files the current diff still has.
  const viewedFilesInDiffCount = useMemo(
    () => (diffData?.files ?? []).filter((file) => viewedFiles.has(file.path)).length,
    [diffData, viewedFiles],
  );

  // Reset initialization flag when diff context changes
  useEffect(() => {
    collapsedInitializedRef.current = false;
  }, [diffData?.repositoryId, resolvedSelectionKey, diffData?.commit]);

  // Initialize collapsed files from viewed files (only once per diff)
  useEffect(() => {
    if (!collapsedInitializedRef.current && hasLoadedInitialViewedFiles) {
      setCollapsedFiles(new Set(viewedFiles));
      collapsedInitializedRef.current = true;
    }
  }, [viewedFiles, hasLoadedInitialViewedFiles]);
  const {
    renderedFilePaths,
    ensureFileRendered,
    ensureFilesRenderedUpTo,
    registerLazyFileContainer,
    scrollFileIntoDiffContainer,
    scrollToFileRestoringPosition,
    isFileScrolledPastContainerTop,
  } = useLazyDiffRendering({
    diffData,
    diffScrollContainerRef,
    setDiffData,
  });

  const toggleFileReviewed = useCallback(
    async (filePath: string) => {
      if (!diffData) return;

      const file = diffData.files.find((f) => f.path === filePath);
      if (!file) return;

      const wasViewed = viewedFiles.has(filePath);
      // Measure before the collapse re-renders: only re-anchor the header when
      // the user is scrolled past it (deep inside a long file), so the viewport
      // doesn't land in unrelated content after collapsing (#164). If the header
      // is already visible, stay stationary and let files below fill up (#402).
      const shouldScrollToHeader = !wasViewed && isFileScrolledPastContainerTop(filePath);
      await toggleFileViewed(filePath, file);

      // Update collapsed state based on viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        if (!wasViewed) {
          // Marking as viewed -> collapse the file
          newSet.add(filePath);
        } else {
          // Marking as not viewed -> expand the file
          newSet.delete(filePath);
        }
        return newSet;
      });

      if (shouldScrollToHeader) {
        setTimeout(() => {
          scrollFileIntoDiffContainer(filePath);
        }, 100);
      }
    },
    [
      diffData,
      isFileScrolledPastContainerTop,
      scrollFileIntoDiffContainer,
      toggleFileViewed,
      viewedFiles,
    ],
  );

  const toggleFolderReviewed = useCallback(
    async (folderPath: string, reviewed: boolean) => {
      if (!diffData) return;

      const folderFiles = diffData.files.filter((file) => file.path.startsWith(`${folderPath}/`));
      if (folderFiles.length === 0) return;

      await setFilesViewed(folderFiles, reviewed);

      // Keep the collapse state of every file in the folder in sync with its viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        folderFiles.forEach((file) => {
          if (reviewed) {
            newSet.add(file.path);
          } else {
            newSet.delete(file.path);
          }
        });
        return newSet;
      });
    },
    [diffData, setFilesViewed],
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const toggleAllFilesCollapsed = useCallback(
    (shouldCollapse: boolean) => {
      if (!diffData) return;

      if (shouldCollapse) {
        // Collapse all files
        setCollapsedFiles(new Set(diffData.files.map((f) => f.path)));
      } else {
        // Expand all files
        setCollapsedFiles(new Set());
      }
    },
    [diffData],
  );

  const handleMobileFileSelected = useCallback(() => {
    setIsFileTreeOpen(false);
  }, []);

  const handleDiffModeChange = useCallback((mode: DiffViewMode) => {
    setDiffMode(mode);
    try {
      window.localStorage.setItem(DIFF_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    saveClientSettings({ diffViewMode: mode });
  }, []);

  const handleMarkdownPreviewModeChange = useCallback((mode: PreviewMode) => {
    setMarkdownPreviewMode(mode);
    try {
      window.localStorage.setItem(MARKDOWN_PREVIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    saveClientSettings({ markdownPreviewMode: mode });
  }, []);

  // Lift expand state to App level so navigation and rendering share the same merged chunks
  const {
    isLoading: isExpandLoading,
    expandLines,
    expandAllBetweenChunks,
    expandAllLines,
    collapseExpandedLines,
    prefetchFileContent,
    getMergedChunks,
    lastUpdatedAt,
  } = useExpandedLines({
    baseCommitish: diffData?.baseCommitish,
    targetCommitish: diffData?.targetCommitish,
    diffIdentity: diffDataVersion,
  });

  const getMergedChunksRef = useRef(getMergedChunks);
  useEffect(() => {
    getMergedChunksRef.current = getMergedChunks;
  }, [getMergedChunks]);

  const [mergedChunksState, setMergedChunksState] = useState(EMPTY_MERGED_CHUNKS_STATE);
  const filesByPath = useMemo(() => {
    const map = new Map<string, DiffResponse['files'][number]>();
    diffData?.files.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [diffData]);

  // Recompute merged chunks for the current fetched diff only.
  useEffect(() => {
    if (!diffData) {
      setMergedChunksState(EMPTY_MERGED_CHUNKS_STATE);
      return;
    }

    setMergedChunksState(
      buildMergedChunksState(diffDataVersion, renderedFilePaths, filesByPath, (file) =>
        getMergedChunksRef.current(file),
      ),
    );
  }, [diffData, diffDataVersion, filesByPath, renderedFilePaths, lastUpdatedAt]);

  // Create files with merged chunks for keyboard navigation
  const navigableFiles = useMemo(() => {
    if (!diffData) return [];
    return diffData.files.map((file) => ({
      ...file,
      chunks:
        getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) || file.chunks,
    }));
  }, [diffData, diffDataVersion, mergedChunksState]);

  const fileLineIndexByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildFileLineIndex>>();
    navigableFiles.forEach((file) => {
      map.set(file.path, buildFileLineIndex(file));
    });
    return map;
  }, [navigableFiles]);

  const normalizedThreads = useMemo<CommentThread[]>(
    () =>
      threads.map((thread) => ({
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
        isOutdated: isThreadOutdated(thread, fileLineIndexByPath.get(thread.filePath)),
        messages: thread.messages,
        resolved: thread.resolved,
        todo: thread.todo,
      })),
    [threads, fileLineIndexByPath],
  );
  const commentCounts = useMemo(
    () => ({
      open: normalizedThreads.filter((thread) => matchesCommentFilter(thread, 'open')).length,
      unread: normalizedThreads.filter((thread) => matchesCommentFilter(thread, 'unread')).length,
      todo: normalizedThreads.filter((thread) => matchesCommentFilter(thread, 'todo')).length,
    }),
    [normalizedThreads],
  );
  const showAuthorBadges = useMemo(
    () => hasMultipleCommentAuthors(normalizedThreads.flatMap((thread) => thread.messages)),
    [normalizedThreads],
  );
  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    normalizedThreads.forEach((thread) => {
      const entry = map.get(thread.file);
      if (entry) {
        entry.push(thread);
      } else {
        map.set(thread.file, [thread]);
      }
    });
    return map;
  }, [normalizedThreads]);

  // State to trigger comment creation from keyboard
  const [commentTrigger, setCommentTrigger] = useState<{
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null>(null);
  // State to toggle "expand all lines" from keyboard
  const [expandToggleTrigger, setExpandToggleTrigger] = useState<{ fileIndex: number } | null>(
    null,
  );
  // State to open a file comment from keyboard
  const [fileCommentTrigger, setFileCommentTrigger] = useState<{ fileIndex: number } | null>(null);
  const fetchDiffDataRef = useRef<((selection?: DiffSelection) => Promise<void>) | null>(null);
  const handleWatchReload = useCallback(async () => {
    await fetchDiffDataRef.current?.();
  }, []);
  const handleCommentsChanged = useCallback(async () => {
    try {
      const serverThreads = await fetchServerThreads();
      skipNextCommentSyncRef.current = true;
      replaceThreads(serverThreads);
      if (commentsContextKey) {
        setBootstrappedCommentsKey(commentsContextKey);
      }
    } catch (commentsError) {
      console.error('Failed to refresh comments from server:', commentsError);
    }
  }, [commentsContextKey, fetchServerThreads, replaceThreads]);

  // File watch for reload functionality - initialize with callback
  const { shouldReload, reload, watchState } = useFileWatch(
    handleWatchReload,
    handleCommentsChanged,
  );

  // The file under the mouse, looked up from the last pointer position: collapsing a file
  // slides the next one under a still mouse, and no mouseenter fires for that.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastNavigatedThreadIdRef = useRef<string | null>(null);
  const filePathAtPointer = useCallback(() => {
    const pointer = pointerRef.current;
    const main = diffScrollContainerRef.current;
    if (!pointer || !main) return null;
    const section = document
      .elementFromPoint(pointer.x, pointer.y)
      ?.closest<HTMLElement>('[data-file-path]');
    return section && main.contains(section) ? (section.dataset.filePath ?? null) : null;
  }, []);

  // The file `v` acts on, marked in the diff and the file list. Whatever was used last decides:
  // the mouse (moved or wheeled) picks the file under it, the keyboard cursor its own file, and
  // a click in the file list the clicked file.
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const currentFilePathRef = useRef(currentFilePath);
  currentFilePathRef.current = currentFilePath;
  const isPointerLeadingRef = useRef(false);
  const getHoveredFileIndex = useCallback(() => {
    const path =
      (isPointerLeadingRef.current ? filePathAtPointer() : null) ?? currentFilePathRef.current;
    const index = path ? (diffData?.files.findIndex((file) => file.path === path) ?? -1) : -1;
    return index >= 0 ? index : null;
  }, [filePathAtPointer, diffData]);
  const markHoveredFile = useCallback(() => {
    if (!isPointerLeadingRef.current) return;
    const path = filePathAtPointer();
    if (path) setCurrentFilePath(path);
  }, [filePathAtPointer]);
  const scrollToFileFromList = useCallback(
    (path: string) => {
      isPointerLeadingRef.current = false;
      setCurrentFilePath(path);
      scrollToFileRestoringPosition(path);
    },
    [scrollToFileRestoringPosition],
  );

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      isPointerLeadingRef.current = true;
      markHoveredFile();
    };
    const onWheel = () => {
      isPointerLeadingRef.current = true;
    };
    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      // Left the window
      pointerRef.current = null;
      markHoveredFile();
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('scroll', markHoveredFile, true);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('scroll', markHoveredFile, true);
    };
  }, [markHoveredFile]);

  // Collapsing or expanding a file moves the others under the mouse
  useEffect(() => {
    const frame = requestAnimationFrame(markHoveredFile);
    return () => cancelAnimationFrame(frame);
  }, [collapsedFiles, viewedFiles, markHoveredFile]);

  // Files shown whole have no hunks worth stepping through
  const isShownWhole = useCallback(
    (fileIndex: number) => {
      const file = diffData?.files[fileIndex];
      if (!file) return false;
      const viewerId = getViewerForFile(file).id;
      if (
        (viewerId === 'markdown' || viewerId === 'asciidoc') &&
        markdownPreviewMode === 'full-preview'
      ) {
        return true;
      }
      const chunks = getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path);
      return !!chunks && !chunksHaveHiddenLines(chunks) && chunksHaveExpandedLines(chunks);
    },
    [diffData, markdownPreviewMode, mergedChunksState, diffDataVersion],
  );

  const { cursor, isHelpOpen, setIsHelpOpen, setCursorPosition, rememberFilePosition } =
    useKeyboardNavigation({
      files: navigableFiles,
      isShownWhole,
      comments: normalizedThreads,
      viewMode: diffMode,
      reviewedFiles: viewedFiles,
      onToggleReviewed: toggleFileReviewed,
      getHoveredFileIndex,
      onCreateComment: () => {
        if (cursor) {
          setCommentTrigger({
            fileIndex: cursor.fileIndex,
            chunkIndex: cursor.chunkIndex,
            lineIndex: cursor.lineIndex,
          });
        }
      },
      onNavigateUnread: (direction) => navigateUnread(direction),
      onToggleTodo: () => toggleTodoAtPointer(),
      onCopyAllComments: () => {
        if (threads.length > 0) {
          void handleCopyAllComments();
        }
      },
      onDeleteAllComments: () => {
        if (threads.length > 0 && confirm('Delete all comments?')) {
          clearAllComments();
        }
      },
      onShowCommentsList: () => {
        openCommentsList();
      },
      onRefresh: () => {
        reload();
      },
      onPreviewModeChange: handleMarkdownPreviewModeChange,
      onToggleExpandAllLines: (fileIndex) => setExpandToggleTrigger({ fileIndex }),
      onCreateFileComment: (fileIndex) => setFileCommentTrigger({ fileIndex }),
    });

  // A cursor move hands the current file to the keyboard until the mouse moves again
  useEffect(() => {
    const filePath = cursor ? diffData?.files[cursor.fileIndex]?.path : undefined;
    if (!filePath) return;
    isPointerLeadingRef.current = false;
    setCurrentFilePath(filePath);
  }, [cursor, diffData]);

  // Viewed button in the diff header: silently remember the toggled file as
  // the navigation position, so keyboard navigation resumes from it without
  // showing any keyboard UI for a mouse interaction
  const handleViewedButtonToggle = useCallback(
    (filePath: string) => {
      void toggleFileReviewed(filePath);
      if (diffData) {
        const fileIndex = diffData.files.findIndex((f) => f.path === filePath);
        if (fileIndex !== -1) {
          rememberFilePosition(fileIndex);
        }
      }
    },
    [toggleFileReviewed, diffData, rememberFilePosition],
  );

  useEffect(() => {
    if (!diffData || !cursor) return;

    const filePath = diffData.files[cursor.fileIndex]?.path;
    if (!filePath || renderedFilePaths.has(filePath)) return;

    ensureFilesRenderedUpTo(filePath);
    requestAnimationFrame(() => {
      setCursorPosition(cursor);
    });
  }, [cursor, diffData, ensureFilesRenderedUpTo, renderedFilePaths, setCursorPosition]);

  const handleLineClick = useCallback(
    (fileIndex: number, chunkIndex: number, lineIndex: number, side: 'left' | 'right') => {
      setCursorPosition({
        fileIndex,
        chunkIndex,
        lineIndex,
        side,
      });
    },
    [setCursorPosition],
  );

  const handleCommentTriggerHandled = useCallback(() => {
    setCommentTrigger(null);
  }, [setCommentTrigger]);

  const handleExpandToggleHandled = useCallback(() => setExpandToggleTrigger(null), []);
  const handleFileCommentTriggerHandled = useCallback(() => setFileCommentTrigger(null), []);

  const handleGenerateThreadPrompt = useCallback(
    (thread: CommentThread) => generateThreadPrompt(thread.id),
    [generateThreadPrompt],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + (e.clientX - startX)),
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const fetchDiffData = useCallback(
    async (selection?: DiffSelection) => {
      const requestId = diffRequestIdRef.current + 1;
      diffRequestIdRef.current = requestId;
      activeDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeDiffAbortControllerRef.current = controller;
      try {
        const requestedSelection =
          selection ??
          (hasUserSelectedRevisionRef.current ? selectedRevisionRef.current : undefined);
        const params = new URLSearchParams({
          ignoreWhitespace: String(ignoreWhitespace),
        });
        if (requestedSelection?.baseCommitish) params.set('base', requestedSelection.baseCommitish);
        if (requestedSelection?.targetCommitish)
          params.set('target', requestedSelection.targetCommitish);
        if (requestedSelection?.baseMode === 'merge-base')
          params.set('baseMode', requestedSelection.baseMode);

        const response = await fetch(`/api/diff?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to fetch diff data');
        const data = (await response.json()) as DiffResponse;
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setDiffData(data);
        setDiffDataVersion((prev) => prev + 1);
        if (data.title) document.title = data.title;

        // Update resolved revision state from server response
        setResolvedBaseRevision(
          data.baseCommitish && data.requestedBaseMode !== 'merge-base' ? data.baseCommitish : '',
        );
        if (data.targetCommitish) setResolvedTargetRevision(data.targetCommitish);

        if (!hasUserSelectedRevisionRef.current) {
          const requestedBase = data.requestedBaseCommitish ?? data.baseCommitish;
          const requestedTarget = data.requestedTargetCommitish ?? data.targetCommitish;
          if (requestedBase && requestedTarget) {
            setSelectedRevision(
              createDiffSelection(requestedBase, requestedTarget, data.requestedBaseMode),
            );
          }
        }

        // Lock files are now automatically marked as viewed by useViewedFiles hook
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          return;
        }
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (activeDiffAbortControllerRef.current === controller) {
          activeDiffAbortControllerRef.current = null;
        }
        if (diffRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [ignoreWhitespace],
  );
  fetchDiffDataRef.current = fetchDiffData;

  useEffect(() => {
    void fetchDiffData();
  }, [fetchDiffData]);

  useEffect(() => {
    return () => {
      activeDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isMobile && diffMode !== 'unified') {
      setDiffMode('unified');
    }
  }, [diffMode, isMobile]);

  // Hydrate UI settings from the server-persisted config so they survive
  // across ports (localStorage is origin-scoped and resets on a new port).
  // Settings the server doesn't know yet are seeded from localStorage.
  useEffect(() => {
    let cancelled = false;

    void fetchClientSettings().then((client) => {
      if (cancelled || !client) {
        return;
      }

      const seed: Record<string, unknown> = {};

      const remoteDiffViewMode = parseDiffViewMode(client.diffViewMode);
      if (remoteDiffViewMode) {
        setDiffMode(remoteDiffViewMode);
      } else {
        const localDiffViewMode = getStoredDiffViewMode();
        if (localDiffViewMode) {
          seed.diffViewMode = localDiffViewMode;
        }
      }

      const remoteMarkdownPreviewMode = parsePreviewMode(client.markdownPreviewMode);
      if (remoteMarkdownPreviewMode) {
        setMarkdownPreviewMode(remoteMarkdownPreviewMode);
      } else {
        const localMarkdownPreviewMode = getStoredMarkdownPreviewMode();
        if (localMarkdownPreviewMode) {
          seed.markdownPreviewMode = localMarkdownPreviewMode;
        }
      }

      if (typeof client.sidebarWidth === 'number' && Number.isFinite(client.sidebarWidth)) {
        setSidebarWidth(clampSidebarWidth(client.sidebarWidth));
      } else {
        const localSidebarWidth = getStoredSidebarWidth();
        if (localSidebarWidth !== null) {
          seed.sidebarWidth = localSidebarWidth;
        }
      }

      if (typeof client.sidebarOpen === 'boolean') {
        setIsFileTreeOpen(client.sidebarOpen);
      } else {
        const localSidebarOpen = getStoredSidebarOpen();
        if (localSidebarOpen !== null) {
          seed.sidebarOpen = localSidebarOpen;
        }
      }

      if (Object.keys(seed).length > 0) {
        saveClientSettings(seed);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const skipInitialSidebarWidthSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    // Skip the mount run so simply opening difit doesn't write the config file.
    if (skipInitialSidebarWidthSaveRef.current) {
      skipInitialSidebarWidthSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarWidth });
  }, [sidebarWidth]);

  const skipInitialSidebarOpenSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(isFileTreeOpen));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    if (skipInitialSidebarOpenSaveRef.current) {
      skipInitialSidebarOpenSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarOpen: isFileTreeOpen });
  }, [isFileTreeOpen]);

  // Fetch revision options on mount
  useEffect(() => {
    fetch('/api/revisions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RevisionsResponse | null) => {
        setRevisionOptions(data);
        if (
          data?.resolvedBase &&
          normalizeBaseMode(currentRequestedBaseModeRef.current) !== 'merge-base'
        ) {
          setResolvedBaseRevision((prev) => prev || data.resolvedBase || '');
        }
        if (data?.resolvedTarget) {
          setResolvedTargetRevision((prev) => prev || data.resolvedTarget || '');
        }
      })
      .catch(() => setRevisionOptions(null));
  }, []);

  // Handle revision change
  const handleRevisionChange = useCallback(
    async (nextSelection: DiffSelection) => {
      // Skip if no actual change
      if (diffSelectionsEqual(nextSelection, selectedRevision)) return;

      hasUserSelectedRevisionRef.current = true;
      selectedRevisionRef.current = nextSelection;
      setSelectedRevision(nextSelection);
      setLoading(true);
      setError(null);
      await fetchDiffData(nextSelection);
    },
    [fetchDiffData, selectedRevision],
  );

  // Clear comments and viewed files on initial load if requested via CLI flag
  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      pendingBootstrapAfterLocalResetRef.current = true;
      clearAllComments({ resetAppliedCommentImportIds: true });
      clearViewedFiles();
      console.log(
        '✅ All existing comments and viewed files cleared as requested via --clean flag',
      );
    }
  }, [diffData?.clearComments, clearAllComments, clearViewedFiles]);

  useEffect(() => {
    if (!commentsContextKey || !hasLoadedComments) {
      return;
    }

    if (bootstrappedCommentsKey === commentsContextKey) {
      return;
    }

    if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
      return;
    }

    const shouldReplaceFromServer = pendingBootstrapAfterLocalResetRef.current;
    pendingBootstrapAfterLocalResetRef.current = false;

    bootstrappingCommentsKeyRef.current = commentsContextKey;
    let cancelled = false;

    const bootstrapComments = async () => {
      try {
        const serverThreads = await fetchServerThreads();
        // Local threads are merged in only until the server has a comment file (migration).
        const replaceFromServer = shouldReplaceFromServer || serverCommentsPersistedRef.current;
        const nextThreads = replaceFromServer
          ? serverThreads
          : mergeCommentThreads(serverThreads, threads).threads;
        if (cancelled) {
          return;
        }

        skipNextCommentSyncRef.current = true;
        replaceThreads(nextThreads);

        if (!replaceFromServer && JSON.stringify(serverThreads) !== JSON.stringify(nextThreads)) {
          await syncThreadsToServer(nextThreads);
        }
      } catch (commentsError) {
        if (!cancelled) {
          console.error('Failed to bootstrap comments from server:', commentsError);
        }
      } finally {
        if (!cancelled) {
          setBootstrappedCommentsKey(commentsContextKey);
        }
        if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
          bootstrappingCommentsKeyRef.current = null;
        }
      }
    };

    void bootstrapComments();

    return () => {
      cancelled = true;
      if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
        bootstrappingCommentsKeyRef.current = null;
      }
    };
  }, [
    bootstrappedCommentsKey,
    commentsContextKey,
    fetchServerThreads,
    hasLoadedComments,
    replaceThreads,
    syncThreadsToServer,
    threads,
  ]);

  useEffect(() => {
    if (!hasBootstrappedComments || pendingFileNotes.length === 0) return;
    addFileNotes(pendingFileNotes);
    setPendingFileNotes([]);
  }, [addFileNotes, hasBootstrappedComments, pendingFileNotes]);

  // Trigger sparkle animation when all files are viewed
  useEffect(() => {
    if (diffData) {
      // Reset the trigger flag when not all files are viewed
      if (viewedFilesInDiffCount < diffData.files.length) {
        setHasTriggeredSparkles(false);
      }
      // Show sparkles when all files are viewed and not already triggered
      else if (viewedFilesInDiffCount === diffData.files.length && !hasTriggeredSparkles) {
        setShowSparkles(true);
        setHasTriggeredSparkles(true);
        // Hide sparkles after animation completes
        setTimeout(() => {
          setShowSparkles(false);
        }, 1000);
      }
    }
  }, [viewedFilesInDiffCount, diffData, hasTriggeredSparkles]);

  // Send comments to server whenever they change and before page unload
  useEffect(() => {
    if (!hasBootstrappedComments) {
      return;
    }

    const data = JSON.stringify({
      threads,
      baseVersion: serverCommentVersionRef.current ?? undefined,
    });
    const commentsApiUrl = getCommentApiUrl('/api/comments');

    // Also handle page unload
    const sendCommentsBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload, including empty states.
      navigator.sendBeacon(commentsApiUrl, data);
    };

    window.addEventListener('beforeunload', sendCommentsBeforeUnload);

    if (skipNextCommentSyncRef.current) {
      skipNextCommentSyncRef.current = false;
      return () => {
        window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
      };
    }

    syncThreadsToServer(threads).catch((syncError) => {
      console.error('Failed to sync comments:', syncError);
    });

    return () => {
      window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
    };
  }, [getCommentApiUrl, hasBootstrappedComments, syncThreadsToServer, threads]);

  // Establish SSE connection for tab close detection
  useEffect(() => {
    const eventSource = new EventSource(resolveEventSourceUrl('/api/heartbeat'));

    eventSource.onopen = () => {
      console.log('Connected to server heartbeat');
    };

    eventSource.onerror = () => {
      console.log('Server connection lost');
      eventSource.close();
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  const handleAddComment = useCallback(
    (
      file: string,
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
    ): Promise<void> => {
      addThread({
        filePath: file,
        body,
        side: side || 'new',
        line: typeof line === 'number' ? line : { start: line[0], end: line[1] },
        codeSnapshot:
          codeContent !== undefined
            ? {
                content: codeContent,
                language: undefined,
              }
            : undefined,
      });
      return Promise.resolve();
    },
    [addThread],
  );

  const handleCopyAllComments = async () => {
    try {
      const prompt = generateAllCommentsPrompt({
        requestedBaseCommitish: diffData?.requestedBaseCommitish,
        requestedTargetCommitish: diffData?.requestedTargetCommitish,
        baseMode: normalizeBaseMode(diffData?.requestedBaseMode),
        resolvedBaseCommitish: diffData?.baseCommitish,
        resolvedTargetCommitish: diffData?.targetCommitish,
      });
      await copyTextToClipboard(prompt);
      setIsCopiedAll(true);
      setTimeout(() => setIsCopiedAll(false), 2000);
    } catch (error) {
      console.error('Failed to copy all comments prompt:', error);
    }
  };

  const handleReplyToThread = useCallback(
    (threadId: string, body: string): Promise<void> => {
      replyToThread({ threadId, body });
      return Promise.resolve();
    },
    [replyToThread],
  );

  const handleNavigateToComment = (thread: CommentThread) => {
    if (!diffData) return;
    lastNavigatedThreadIdRef.current = thread.id;

    if (isFileCommentLine(thread.line)) {
      scrollToFileFromList(thread.file);
      return;
    }

    const position = findCommentPosition(thread, diffData.files);
    if (position) {
      setCursorPosition(position);
    }
  };

  // u / Shift+U: the next or previous unread thread in diff order, after the last one jumped to.
  function navigateUnread(direction: 'next' | 'prev') {
    if (!diffData) return;
    const fileOrder = new Map(diffData.files.map((file, index) => [file.path, index]));
    const firstLine = (thread: CommentThread) =>
      Array.isArray(thread.line) ? thread.line[0] : thread.line;
    const ordered = [...normalizedThreads].sort(
      (a, b) =>
        (fileOrder.get(a.file) ?? Infinity) - (fileOrder.get(b.file) ?? Infinity) ||
        firstLine(a) - firstLine(b) ||
        a.createdAt.localeCompare(b.createdAt),
    );
    const current = ordered.findIndex((thread) => thread.id === lastNavigatedThreadIdRef.current);
    const unread = ordered
      .map((thread, index) => ({ thread, index }))
      .filter(({ thread }) => matchesCommentFilter(thread, 'unread'));
    if (unread.length === 0) return;
    const target =
      direction === 'next'
        ? (unread.find(({ index }) => index > current) ?? unread[0])
        : ([...unread].reverse().find(({ index }) => index < current) ?? unread[unread.length - 1]);
    if (!target) return;
    handleNavigateToComment(target.thread);
    setTimeout(() => {
      document
        .getElementById(`comment-thread-${target.thread.id}`)
        ?.scrollIntoView({ block: 'center' });
    }, 50);
  }

  // t: the todo flag of the thread under the mouse, else of the last thread jumped to.
  function toggleTodoAtPointer() {
    const pointer = pointerRef.current;
    const card = pointer
      ? document.elementFromPoint(pointer.x, pointer.y)?.closest('[id^="comment-thread-"]')
      : null;
    const threadId = card
      ? card.id.slice('comment-thread-'.length)
      : lastNavigatedThreadIdRef.current;
    if (threadId) toggleTodo(threadId);
  }

  const handleOpenInEditor = useCallback(
    async (filePath: string, lineNumber: number) => {
      try {
        const response = await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath,
            line: lineNumber,
            editor: settings.editor,
          }),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          let message = response.statusText;
          if (
            payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof (payload as { error?: unknown }).error === 'string'
          ) {
            message = (payload as { error: string }).error;
          }
          console.error('Failed to open file in editor:', message);
        }
      } catch (error) {
        console.error('Failed to open file in editor:', error);
      }
    },
    [settings.editor],
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    // Clear cursor position
    setCursorPosition(null);

    // Check if clicking on a comment button
    const target = e.target as HTMLElement;
    const isCommentButton = target.closest('[data-comment-button="true"]');
    const isOpenInEditorButton = target.closest('[data-open-in-editor-button="true"]');
    const isShiftRangeClick = e.shiftKey && target.closest('[data-diff-line-row="true"]');

    // Close empty comment forms (unless clicking on a comment button)
    if (!isCommentButton && !isOpenInEditorButton && !isShiftRangeClick) {
      closeEmptyCommentForms(e);
    }
  };

  const closeEmptyCommentForms = (e: React.MouseEvent) => {
    const emptyForms = document.querySelectorAll('form[data-empty="true"]');
    emptyForms.forEach((form) => {
      // Don't close if clicking inside the form itself
      if (!form.contains(e.target as Node)) {
        const cancelButton = form.querySelector<HTMLButtonElement>('[data-comment-cancel="true"]');
        cancelButton?.click();
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-github-bg-primary">
        <div className="text-github-text-secondary text-base">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">Error</h2>
        <p className="text-github-text-secondary text-base">{error}</p>
      </div>
    );
  }

  if (!diffData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">No data</h2>
        <p className="text-github-text-secondary text-base">No diff data available</p>
      </div>
    );
  }

  const canOpenInEditor =
    diffData.openInEditorAvailable !== false &&
    settings.editor.id !== 'none' &&
    settings.editor.command.trim() !== '' &&
    settings.editor.argsTemplate.trim() !== '';

  return (
    <CommentActionsProvider value={commentActions}>
      <WordHighlightProvider>
        <div className="h-screen flex flex-col" onClickCapture={handleGlobalClick}>
          <header
            className={`bg-github-bg-secondary border-b border-github-border flex ${
              isMobile ? 'flex-col' : 'flex-row items-center'
            }`}
          >
            <div
              className={`flex items-center justify-between w-full ${
                isMobile ? 'px-3 py-2 gap-3' : 'px-4 py-3 gap-4 w-auto'
              } ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isMobile ? '100%' : isFileTreeOpen ? `${sidebarWidth}px` : 'auto',
                minWidth: isMobile ? '0px' : isFileTreeOpen ? '200px' : 'auto',
                maxWidth: isMobile ? 'none' : isFileTreeOpen ? '600px' : 'none',
              }}
            >
              <h1>
                <Logo
                  style={{
                    height: '18px',
                    color: 'var(--color-github-text-secondary)',
                  }}
                />
              </h1>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsFileTreeOpen(!isFileTreeOpen)}
                  className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                  title={isFileTreeOpen ? 'Collapse file tree' : 'Expand file tree'}
                  aria-expanded={isFileTreeOpen}
                  aria-controls="file-tree-panel"
                  aria-label="Toggle file tree panel"
                >
                  {isFileTreeOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
                </button>
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                  title="Settings"
                >
                  <Settings size={18} />
                </button>
              </div>
            </div>
            {!isMobile && (
              <div
                className={`border-r border-github-border ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
                style={{
                  width: isFileTreeOpen ? '4px' : '0px',
                  height: 'calc(100% - 16px)',
                  margin: '8px 0',
                  transform: 'translateX(-2px)',
                }}
              />
            )}
            <div
              className={`flex-1 flex flex-wrap items-center justify-between ${
                isMobile ? 'px-3 pb-2 gap-3' : 'px-4 py-3 gap-4'
              }`}
            >
              <div className={`flex flex-wrap items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
                {diffData.title && (
                  <span
                    className="max-w-[40ch] truncate text-sm font-semibold text-github-text-primary"
                    title={diffData.title}
                    data-testid="session-title"
                  >
                    {diffData.title}
                  </span>
                )}
                {!isMobile && (
                  <div className="flex bg-github-bg-tertiary border border-github-border rounded-md p-1">
                    <button
                      onClick={() => handleDiffModeChange('split')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                        diffMode === 'split'
                          ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                          : 'text-github-text-secondary hover:text-github-text-primary'
                      }`}
                    >
                      <Columns size={14} />
                      Split
                    </button>
                    <button
                      onClick={() => handleDiffModeChange('unified')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                        diffMode === 'unified'
                          ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                          : 'text-github-text-secondary hover:text-github-text-primary'
                      }`}
                    >
                      <AlignLeft size={14} />
                      Unified
                    </button>
                  </div>
                )}
                <Checkbox
                  checked={ignoreWhitespace}
                  onChange={setIgnoreWhitespace}
                  label="Ignore Whitespace"
                  title={ignoreWhitespace ? 'Show whitespace changes' : 'Ignore whitespace changes'}
                />
                {/* File Watch Reload Button */}
                <ReloadButton
                  shouldReload={shouldReload}
                  isReloading={watchState.isReloading}
                  onReload={reload}
                  changeType={watchState.lastChangeType}
                  compact={isMobile}
                />
              </div>
              <div
                className={`flex flex-wrap items-center text-sm text-github-text-secondary ${
                  isMobile ? 'gap-3' : 'gap-4'
                }`}
              >
                {threads.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openCommentsList()}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-github-bg-tertiary"
                    title="All comment threads (Shift+L)"
                  >
                    <MessageSquare size={13} />
                    {commentCounts.open > 0
                      ? `${commentCounts.open} ${commentCounts.open === 1 ? 'comment' : 'comments'}`
                      : `${threads.length} resolved`}
                  </button>
                )}
                {(commentCounts.unread > 0 || commentCounts.todo > 0) && (
                  <div className="flex items-center gap-1 text-xs" data-testid="comment-counters">
                    {commentCounts.unread > 0 && (
                      <button
                        type="button"
                        onClick={() => openCommentsList('unread')}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-github-bg-tertiary"
                        title="Show unread threads (u: next unread)"
                      >
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        {commentCounts.unread} unread
                      </button>
                    )}
                    {commentCounts.unread > 0 && commentCounts.todo > 0 && <span>·</span>}
                    {commentCounts.todo > 0 && (
                      <button
                        type="button"
                        onClick={() => openCommentsList('todo')}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-orange-500 hover:bg-github-bg-tertiary"
                        title="Show todo threads"
                      >
                        🚩 {commentCounts.todo} {commentCounts.todo === 1 ? 'todo' : 'todos'}
                      </button>
                    )}
                  </div>
                )}
                {!isMobile && threads.length > 0 && (
                  <CommentsDropdown
                    commentsCount={commentCounts.open}
                    isCopiedAll={isCopiedAll}
                    onCopyAll={handleCopyAllComments}
                    onDeleteAll={clearAllComments}
                    onViewAll={() => openCommentsList()}
                  />
                )}
                <div className="flex flex-col gap-1 items-center">
                  <div className="text-xs relative">
                    {viewedFilesInDiffCount === diffData.files.length
                      ? 'All diffs difit-ed!'
                      : `${viewedFilesInDiffCount} / ${diffData.files.length} files viewed`}
                    <SparkleAnimation isActive={showSparkles} />
                  </div>
                  <div
                    className="relative h-2 bg-github-bg-tertiary rounded-full overflow-hidden"
                    style={{
                      width: '90px',
                      border: '1px solid var(--color-github-border)',
                    }}
                  >
                    <div
                      className="absolute top-0 right-0 h-full transition-all duration-300 ease-out"
                      style={{
                        width: `${((diffData.files.length - viewedFilesInDiffCount) / diffData.files.length) * 100}%`,
                        backgroundColor: (() => {
                          const remainingPercent =
                            ((diffData.files.length - viewedFilesInDiffCount) /
                              diffData.files.length) *
                            100;
                          if (remainingPercent > 50) return 'var(--color-github-accent)'; // green
                          if (remainingPercent > 20) return 'var(--color-github-warning)'; // yellow
                          return 'var(--color-github-danger)'; // red
                        })(),
                      }}
                    />
                  </div>
                </div>
                {revisionOptions ? (
                  <DiffQuickMenu
                    options={revisionOptions}
                    selection={selectedRevision}
                    resolvedBaseRevision={resolvedBaseRevision}
                    resolvedTargetRevision={resolvedTargetRevision}
                    onSelectDiff={(selection) => void handleRevisionChange(selection)}
                    onOpenAdvanced={() => setIsRevisionModalOpen(true)}
                    compact={!isDesktop}
                  />
                ) : (
                  <span className="text-xs">
                    Reviewing:{' '}
                    <code className="bg-github-bg-tertiary px-1.5 py-0.5 rounded text-xs text-github-text-primary">
                      {diffData.commit.includes('...') ? (
                        <>
                          <span className="text-github-text-secondary font-medium">
                            {diffData.commit.split('...')[0]}...
                          </span>
                          <span className="font-medium">{diffData.commit.split('...')[1]}</span>
                        </>
                      ) : (
                        diffData.commit
                      )}
                    </code>
                  </span>
                )}
              </div>
            </div>
          </header>
          {revisionOptions && (
            <RevisionDetailModal
              key={isRevisionModalOpen ? getDiffSelectionKey(selectedRevision) : 'closed'}
              isOpen={isRevisionModalOpen}
              onClose={() => setIsRevisionModalOpen(false)}
              options={revisionOptions}
              selection={selectedRevision}
              resolvedBaseRevision={resolvedBaseRevision}
              resolvedTargetRevision={resolvedTargetRevision}
              onApply={(selection) => void handleRevisionChange(selection)}
            />
          )}

          {isMobile && isFileTreeOpen && (
            <button
              type="button"
              aria-label="Close file tree"
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setIsFileTreeOpen(false)}
            />
          )}

          <div className="flex flex-1 overflow-hidden relative">
            <div
              className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isMobile ? '0px' : isFileTreeOpen ? `${sidebarWidth}px` : '0px',
              }}
            >
              <aside
                id="file-tree-panel"
                className={`bg-github-bg-secondary overflow-y-auto flex flex-col ${
                  isMobile
                    ? 'fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] border-l border-github-border transition-transform duration-300 ease-out'
                    : 'relative border-r border-github-border'
                }`}
                style={{
                  width: isMobile ? 'min(85vw, 360px)' : `${sidebarWidth}px`,
                  minWidth: isMobile ? '0px' : '200px',
                  maxWidth: isMobile ? 'none' : '600px',
                  height: '100%',
                  transform: isMobile
                    ? isFileTreeOpen
                      ? 'translateX(0)'
                      : 'translateX(100%)'
                    : undefined,
                }}
              >
                <div className="flex-1 overflow-y-auto">
                  <FileList
                    files={diffData.files}
                    onScrollToFile={scrollToFileFromList}
                    onFileSelected={isMobile ? handleMobileFileSelected : undefined}
                    comments={normalizedThreads}
                    reviewedFiles={viewedFiles}
                    onToggleReviewed={toggleFileReviewed}
                    onToggleFolderReviewed={toggleFolderReviewed}
                    selectedFileIndex={
                      currentFilePath
                        ? diffData.files.findIndex((file) => file.path === currentFilePath)
                        : null
                    }
                  />
                </div>
                {!isMobile && (
                  <div className="p-4 border-t border-github-border flex justify-between items-center">
                    <button
                      onClick={() => setIsHelpOpen(true)}
                      className="flex items-center gap-1.5 text-github-text-secondary hover:text-github-text-primary transition-colors"
                      title="Keyboard shortcuts (Shift+?)"
                    >
                      <Keyboard size={16} />
                      <span className="text-sm">Shortcuts</span>
                    </button>
                    <a
                      href="https://github.com/yoshiko-pg/difit"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-github-text-secondary hover:text-github-text-primary transition-colors"
                      title="View on GitHub"
                    >
                      <span className="text-sm">Star on GitHub</span>
                      <GitHubIcon style={{ height: '18px', width: '18px' }} />
                    </a>
                  </div>
                )}
              </aside>
            </div>

            {!isMobile && (
              <div
                className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
                style={{
                  width: isFileTreeOpen ? '4px' : '0px',
                }}
                onMouseDown={handleMouseDown}
                title="Drag to resize file list"
              />
            )}

            <main
              ref={diffScrollContainerRef}
              className={`flex-1 overflow-y-auto ${showMobileCommentsBar ? 'pb-16' : ''}`}
            >
              {diffData.files.map((file, fileIndex) => {
                const fileThreads = threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS;
                const mergedChunks =
                  getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) ??
                  EMPTY_MERGED_CHUNKS;
                const isRendered = renderedFilePaths.has(file.path);
                return (
                  <div
                    key={file.path}
                    id={getFileElementId(file.path)}
                    data-file-path={file.path}
                    data-rendered={isRendered ? 'true' : 'false'}
                    ref={(node) => registerLazyFileContainer(file.path, node)}
                    data-current-file={file.path === currentFilePath ? '' : undefined}
                    className="mb-6"
                  >
                    {isRendered ? (
                      <DiffViewer
                        file={file}
                        threads={fileThreads}
                        showAuthorBadges={showAuthorBadges}
                        diffMode={diffMode}
                        reviewedFiles={viewedFiles}
                        isChangedSinceViewed={changedSinceViewedFiles.has(file.path)}
                        onToggleReviewed={handleViewedButtonToggle}
                        collapsedFiles={collapsedFiles}
                        onToggleCollapsed={toggleFileCollapsed}
                        onToggleAllCollapsed={toggleAllFilesCollapsed}
                        onAddComment={handleAddComment}
                        onGenerateThreadPrompt={handleGenerateThreadPrompt}
                        onRemoveThread={resolveThread}
                        onReplyToThread={handleReplyToThread}
                        onRemoveMessage={removeMessage}
                        onUpdateMessage={updateMessage}
                        onOpenInEditor={canOpenInEditor ? handleOpenInEditor : undefined}
                        syntaxTheme={settings.syntaxTheme}
                        baseCommitish={diffData.baseCommitish}
                        targetCommitish={diffData.targetCommitish}
                        cursor={cursor?.fileIndex === fileIndex ? cursor : null}
                        isFocused={cursor?.fileIndex === fileIndex}
                        fileIndex={fileIndex}
                        onLineClick={handleLineClick}
                        commentTrigger={
                          commentTrigger?.fileIndex === fileIndex ? commentTrigger : null
                        }
                        onCommentTriggerHandled={handleCommentTriggerHandled}
                        expandToggleTrigger={
                          expandToggleTrigger?.fileIndex === fileIndex ? expandToggleTrigger : null
                        }
                        onExpandToggleHandled={handleExpandToggleHandled}
                        fileCommentTrigger={
                          fileCommentTrigger?.fileIndex === fileIndex ? fileCommentTrigger : null
                        }
                        onFileCommentTriggerHandled={handleFileCommentTriggerHandled}
                        mergedChunks={mergedChunks}
                        expandLines={expandLines}
                        expandAllBetweenChunks={expandAllBetweenChunks}
                        expandAllLines={expandAllLines}
                        collapseExpandedLines={collapseExpandedLines}
                        prefetchFileContent={prefetchFileContent}
                        isExpandLoading={isExpandLoading}
                        diffVersion={diffDataVersion}
                        markdownPreviewMode={markdownPreviewMode}
                        onMarkdownPreviewModeChange={handleMarkdownPreviewModeChange}
                      />
                    ) : (
                      <div className="bg-github-bg-secondary border border-github-border rounded-md px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wide text-github-text-muted">
                              Deferred Rendering
                            </div>
                            <div className="text-sm font-mono text-github-text-primary truncate">
                              {file.path}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => ensureFileRendered(file.path)}
                            className="px-3 py-1.5 text-xs rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary"
                          >
                            Load now
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </main>
          </div>

          {showMobileCommentsBar && (
            <div className="fixed bottom-0 left-0 right-0 z-20 bg-github-bg-secondary border-t border-github-border px-4 py-2 flex justify-end">
              <CommentsDropdown
                commentsCount={threads.length}
                isCopiedAll={isCopiedAll}
                onCopyAll={handleCopyAllComments}
                onDeleteAll={clearAllComments}
                onViewAll={() => openCommentsList()}
                direction="up"
                compact
              />
            </div>
          )}

          {isSettingsOpen && (
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              settings={settings}
              onSettingsChange={updateSettings}
            />
          )}

          <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

          <CommentsListModal
            isOpen={isCommentsListOpen}
            initialFilter={commentsListFilter}
            onClose={() => setIsCommentsListOpen(false)}
            onNavigate={handleNavigateToComment}
            comments={normalizedThreads}
            showAuthorBadges={showAuthorBadges}
            onRemoveThread={resolveThread}
            onGenerateThreadPrompt={handleGenerateThreadPrompt}
            onReplyToThread={handleReplyToThread}
            onRemoveMessage={removeMessage}
            onUpdateMessage={updateMessage}
            syntaxTheme={settings.syntaxTheme}
          />
        </div>
      </WordHighlightProvider>
    </CommentActionsProvider>
  );
}

export default App;
