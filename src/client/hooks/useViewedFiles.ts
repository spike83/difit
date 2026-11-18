import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import {
  type BaseMode,
  type ViewedFileRecord,
  type DiffFile,
  type ViewedHashIndexEntry,
} from '../../types/diff';
import { getDiffSelectionKey } from '../../utils/diffSelection';
import { snapshotChangeLines } from '../../utils/viewedFileChanges';
import { storageService, VIEWED_HASH_VERSION } from '../services/StorageService';
import { matchesAutoViewedPatterns } from '../utils/autoViewedPatterns';
import { generateDiffHash, getDiffContentForHashing } from '../utils/diffUtils';

/** A viewed file whose diff changed; `previous` is its change lines when it was viewed. */
export interface ViewedFileChange {
  file: DiffFile;
  previous?: string[];
}

interface UseViewedFilesReturn {
  viewedFiles: Set<string>; // Set of file paths
  /**
   * Set of file paths that were marked viewed before — in this comparison range
   * or, per the per-repo hash index, in a prior one — but whose current diff
   * hash matches none of those views. Used to surface a "changed since you
   * viewed" indicator for incremental code reviews.
   */
  changedSinceViewedFiles: Set<string>;
  hasLoadedInitialViewedFiles: boolean;
  toggleFileViewed: (filePath: string, diffFile: DiffFile) => Promise<void>;
  setFilesViewed: (diffFiles: DiffFile[], viewed: boolean) => Promise<void>;
  isFileContentChanged: (filePath: string, diffFile: DiffFile) => Promise<boolean>;
  getViewedFileRecord: (filePath: string) => ViewedFileRecord | undefined;
  clearViewedFiles: () => void;
}

export function useViewedFiles(
  baseCommitish?: string,
  targetCommitish?: string,
  currentCommitHash?: string,
  branchToHash?: Map<string, string>,
  initialFiles?: DiffFile[],
  repositoryId?: string,
  autoViewedPatterns: string[] = [],
  baseMode?: BaseMode,
  /** Diff settings (whitespace, context); a change of them re-renders files without changing them. */
  diffVariant?: string,
  onViewedFilesChanged?: (changes: ViewedFileChange[]) => void,
): UseViewedFilesReturn {
  const [viewedFileRecords, setViewedFileRecords] = useState<ViewedFileRecord[]>([]);
  const [loadedViewedFilesKey, setLoadedViewedFilesKey] = useState<string | null>(null);
  const [changedSinceViewedFiles, setChangedSinceViewedFiles] = useState<Set<string>>(new Set());
  const onViewedFilesChangedRef = useRef(onViewedFilesChanged);
  onViewedFilesChangedRef.current = onViewedFilesChanged;
  const viewedFilesKey =
    baseCommitish && targetCommitish
      ? `${repositoryId ?? 'default'}:${getDiffSelectionKey({
          baseCommitish,
          targetCommitish,
          baseMode,
        })}:${currentCommitHash ?? 'no-commit'}`
      : null;
  const hasLoadedInitialViewedFiles =
    viewedFilesKey !== null && loadedViewedFilesKey === viewedFilesKey;

  // Load viewed files from storage and auto-mark configured/generated files
  useEffect(() => {
    if (!baseCommitish || !targetCommitish || !viewedFilesKey) return;

    let cancelled = false;

    const loadedFiles = storageService.getViewedFiles(
      baseCommitish,
      targetCommitish,
      currentCommitHash,
      branchToHash,
      repositoryId,
      baseMode,
    );

    // Auto-mark generated, deleted, or pattern-matched files as viewed if they
    // are not already marked. Pattern changes are intentionally not reactive here
    // so editing the textarea does not immediately re-mark the current diff.
    const processAutoCollapsedFiles = async () => {
      const additions: ViewedFileRecord[] = [];
      let activeRecords: ViewedFileRecord[] = loadedFiles;

      if (initialFiles && initialFiles.length > 0) {
        // Hash every displayed file once so we can both auto-mark and
        // hydrate-from-index without recomputing.
        const hashByPath = new Map<string, string>();
        await Promise.all(
          initialFiles.map(async (file) => {
            try {
              const hash = await generateDiffHash(getDiffContentForHashing(file));
              hashByPath.set(file.path, hash);
            } catch (err) {
              console.error('Failed to generate hash for file:', file.path, err);
            }
          }),
        );

        // A stored record whose file no longer hashes to the recorded value was
        // viewed and then edited inside this same comparison range. Un-view it,
        // so its diff is expanded again, and flag it as changed below.
        const stalePaths = new Set(
          loadedFiles
            .filter((record) => {
              const currentHash = hashByPath.get(record.filePath);
              return currentHash !== undefined && currentHash !== record.diffContentHash;
            })
            .map((record) => record.filePath),
        );
        activeRecords = loadedFiles.filter((record) => !stalePaths.has(record.filePath));
        const staleChanges = loadedFiles.flatMap((record) => {
          const file = initialFiles.find((candidate) => candidate.path === record.filePath);
          return stalePaths.has(record.filePath) && file
            ? [{ file, previous: record.changeLines }]
            : [];
        });
        if (staleChanges.length > 0 && !cancelled) onViewedFilesChangedRef.current?.(staleChanges);
        const knownPaths = new Set(activeRecords.map((f) => f.filePath));

        // Auto-mark generated / deleted / pattern-matched files.
        for (const file of initialFiles) {
          if (knownPaths.has(file.path)) continue;
          const shouldAutoMarkViewed =
            file.isGenerated ||
            file.status === 'deleted' ||
            matchesAutoViewedPatterns(file.path, autoViewedPatterns);
          if (!shouldAutoMarkViewed) continue;

          const hash = hashByPath.get(file.path);
          if (!hash) continue;

          additions.push({
            filePath: file.path,
            viewedAt: new Date().toISOString(),
            diffContentHash: hash,
          });
          knownPaths.add(file.path);
        }

        // Build per-path lookups from the per-repository hash index. Entries
        // are keyed by (filePath, diffContentHash) so the same file can hold
        // independent viewed state across multiple comparison ranges.
        const index = storageService.getViewedHashIndex(repositoryId);
        const indexedByKey = new Map<string, (typeof index.entries)[number]>();
        const indexedPaths = new Set<string>();
        for (const entry of index.entries) {
          if (entry.hashVersion !== VIEWED_HASH_VERSION) continue;
          indexedByKey.set(`${entry.filePath} ${entry.diffContentHash}`, entry);
          indexedPaths.add(entry.filePath);
        }

        // Hydrate viewed state for files whose current diff matches a prior view.
        for (const file of initialFiles) {
          if (knownPaths.has(file.path)) continue;
          const currentHash = hashByPath.get(file.path);
          if (!currentHash) continue;
          const entry = indexedByKey.get(`${file.path} ${currentHash}`);
          if (!entry) continue;

          additions.push({
            filePath: file.path,
            viewedAt: entry.viewedAt, // preserve original timestamp
            diffContentHash: currentHash,
          });
          knownPaths.add(file.path);
        }

        // Flag files that were viewed before but whose current diff differs
        // from every recorded hash for that path.
        const changed = new Set<string>();
        for (const file of initialFiles) {
          if (!stalePaths.has(file.path) && !indexedPaths.has(file.path)) continue;
          if (knownPaths.has(file.path)) continue; // already viewed (loaded, auto-marked or hydrated)
          const currentHash = hashByPath.get(file.path);
          if (!currentHash) continue;
          if (indexedByKey.has(`${file.path} ${currentHash}`)) continue;
          changed.add(file.path);
        }
        if (!cancelled) setChangedSinceViewedFiles(changed);
      } else {
        if (!cancelled) setChangedSinceViewedFiles(new Set());
      }

      const updatedRecords = [...activeRecords, ...additions];
      if (additions.length > 0 || activeRecords.length < loadedFiles.length) {
        storageService.saveViewedFiles(
          baseCommitish,
          targetCommitish,
          updatedRecords,
          currentCommitHash,
          branchToHash,
          repositoryId,
          baseMode,
        );
      }

      if (!cancelled) {
        setViewedFileRecords(updatedRecords);
        setLoadedViewedFilesKey(viewedFilesKey);
      }
    };

    void processAutoCollapsedFiles();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, [
    baseCommitish,
    targetCommitish,
    currentCommitHash,
    branchToHash,
    repositoryId,
    viewedFilesKey,
    baseMode,
  ]); // initialFiles and autoViewedPatterns intentionally omitted to run only on diff init

  // Save viewed files to storage
  const saveViewedFiles = useCallback(
    (newRecords: ViewedFileRecord[]) => {
      if (!baseCommitish || !targetCommitish) return;

      storageService.saveViewedFiles(
        baseCommitish,
        targetCommitish,
        newRecords,
        currentCommitHash,
        branchToHash,
        repositoryId,
        baseMode,
      );
      setViewedFileRecords(newRecords);
    },
    [baseCommitish, targetCommitish, currentCommitHash, branchToHash, repositoryId, baseMode],
  );

  // After a reload (file watcher, Refresh) a viewed file whose diff changed is unviewed again.
  const recordsRef = useRef(viewedFileRecords);
  recordsRef.current = viewedFileRecords;
  const checkedRef = useRef<{ key: string | null; variant?: string; files?: DiffFile[] }>({
    key: null,
  });
  useEffect(() => {
    const checked = checkedRef.current;
    checkedRef.current = { key: viewedFilesKey, variant: diffVariant, files: initialFiles };
    // The first files of a selection are checked on load; other settings only re-render files.
    if (
      !hasLoadedInitialViewedFiles ||
      !initialFiles ||
      checked.key !== viewedFilesKey ||
      checked.variant !== diffVariant ||
      !checked.files ||
      checked.files === initialFiles
    ) {
      return;
    }
    let cancelled = false;
    const check = async () => {
      const byPath = new Map(initialFiles.map((file) => [file.path, file]));
      const changes: ViewedFileChange[] = [];
      for (const record of recordsRef.current) {
        const file = byPath.get(record.filePath);
        if (!file) continue;
        const hash = await generateDiffHash(getDiffContentForHashing(file));
        if (hash !== record.diffContentHash) changes.push({ file, previous: record.changeLines });
      }
      if (cancelled || changes.length === 0) return;
      const changedPaths = new Set(changes.map(({ file }) => file.path));
      saveViewedFiles(recordsRef.current.filter((record) => !changedPaths.has(record.filePath)));
      setChangedSinceViewedFiles((prev) => new Set([...prev, ...changedPaths]));
      onViewedFilesChangedRef.current?.(changes);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [initialFiles, diffVariant, hasLoadedInitialViewedFiles, saveViewedFiles, viewedFilesKey]);

  // Convert records to Set of file paths for easy checking
  const viewedFiles = useMemo(() => {
    return new Set(viewedFileRecords.map((record) => record.filePath));
  }, [viewedFileRecords]);

  // Get specific file record
  const getViewedFileRecord = useCallback(
    (filePath: string): ViewedFileRecord | undefined => {
      return viewedFileRecords.find((record) => record.filePath === filePath);
    },
    [viewedFileRecords],
  );

  // Generate and cache hash for a file
  // Not cached by path: the same path gets a new diff whenever the file changes.
  const getFileHash = useCallback(
    (diffFile: DiffFile): Promise<string> => generateDiffHash(getDiffContentForHashing(diffFile)),
    [],
  );

  // Check if file content has changed
  const isFileContentChanged = useCallback(
    async (filePath: string, diffFile: DiffFile): Promise<boolean> => {
      const record = getViewedFileRecord(filePath);
      if (!record) return false;

      const currentHash = await getFileHash(diffFile);
      return record.diffContentHash !== currentHash;
    },
    [getViewedFileRecord, getFileHash],
  );

  // Toggle viewed state for a file
  const toggleFileViewed = useCallback(
    async (filePath: string, diffFile: DiffFile): Promise<void> => {
      const existingRecord = getViewedFileRecord(filePath);

      if (existingRecord) {
        // File is already viewed, remove it
        const newRecords = viewedFileRecords.filter((r) => r.filePath !== filePath);
        saveViewedFiles(newRecords);
        // Drop only the matching (path, hash) entry from the cross-comparison
        // index, so the same file viewed in other comparisons keeps its state.
        storageService.removeViewedHashes(repositoryId, [
          { filePath, diffContentHash: existingRecord.diffContentHash },
        ]);
      } else {
        // File is not viewed, add it
        const hash = await getFileHash(diffFile);
        const viewedAt = new Date().toISOString();
        const newRecord: ViewedFileRecord = {
          filePath,
          viewedAt,
          diffContentHash: hash,
          changeLines: snapshotChangeLines(diffFile),
        };

        const newRecords = [...viewedFileRecords, newRecord];
        saveViewedFiles(newRecords);

        const indexEntry: ViewedHashIndexEntry = {
          filePath,
          diffContentHash: hash,
          hashVersion: VIEWED_HASH_VERSION,
          viewedAt,
        };
        storageService.recordViewedHashes(repositoryId, [indexEntry]);
      }
    },
    [viewedFileRecords, getViewedFileRecord, getFileHash, saveViewedFiles, repositoryId],
  );

  // Set viewed state for multiple files at once (e.g. marking an entire folder)
  const setFilesViewed = useCallback(
    async (diffFiles: DiffFile[], viewed: boolean): Promise<void> => {
      if (viewed) {
        const filesToAdd = diffFiles.filter((file) => !getViewedFileRecord(file.path));
        if (filesToAdd.length === 0) return;

        const viewedAt = new Date().toISOString();
        const addedRecords: ViewedFileRecord[] = await Promise.all(
          filesToAdd.map(async (file) => ({
            filePath: file.path,
            viewedAt,
            diffContentHash: await getFileHash(file),
            changeLines: snapshotChangeLines(file),
          })),
        );

        saveViewedFiles([...viewedFileRecords, ...addedRecords]);
        storageService.recordViewedHashes(
          repositoryId,
          addedRecords.map((record) => ({
            filePath: record.filePath,
            diffContentHash: record.diffContentHash,
            hashVersion: VIEWED_HASH_VERSION,
            viewedAt: record.viewedAt,
          })),
        );
      } else {
        const pathsToRemove = new Set(diffFiles.map((file) => file.path));
        const removedRecords = viewedFileRecords.filter((record) =>
          pathsToRemove.has(record.filePath),
        );
        if (removedRecords.length === 0) return;

        saveViewedFiles(viewedFileRecords.filter((record) => !pathsToRemove.has(record.filePath)));
        storageService.removeViewedHashes(
          repositoryId,
          removedRecords.map((record) => ({
            filePath: record.filePath,
            diffContentHash: record.diffContentHash,
          })),
        );
      }
    },
    [viewedFileRecords, getViewedFileRecord, getFileHash, saveViewedFiles, repositoryId],
  );

  // Clear all viewed files
  const clearViewedFiles = useCallback(() => {
    saveViewedFiles([]);
    setChangedSinceViewedFiles(new Set());
    storageService.clearViewedHashIndex(repositoryId);
  }, [saveViewedFiles, repositoryId]);

  return {
    viewedFiles,
    changedSinceViewedFiles,
    hasLoadedInitialViewedFiles,
    toggleFileViewed,
    setFilesViewed,
    isFileContentChanged,
    getViewedFileRecord,
    clearViewedFiles,
  };
}
