"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createProject } from "./process";
import { HISTORY_LIMIT, recordHistory, type HistoryGroup } from "./project-history";
import { cleanupEmptyProjects, DIAGRAM_CLIPBOARD_KEY, hasProjectContent, MAX_FILE_SIZE, parseProject, persistProject, STORAGE_PREFIX } from "./storage";
import type { Project } from "./types";

export type SaveState = "saving" | "saved" | "unavailable";

const SAVE_DELAY = 300;

function setHash(id: string) {
  window.history.replaceState(window.history.state, "", `#${id}`);
}

/** Editing stays synchronous; storage writes are batched and flushed on navigation. */
export function useProject() {
  const [project, setProject] = useState<Project>(() => createProject());
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [unsavedReplacement, setUnsavedReplacement] = useState(false);
  const [notice, setNotice] = useState("");
  const current = useRef(project);
  const isReady = useRef(false);
  const history = useRef<Project[]>([]);
  const historyGroup = useRef<HistoryGroup | null>(null);
  const future = useRef<Project[]>([]);
  const dirty = useRef(false);
  const savedSnapshot = useRef<string | null>(null);
  const pending = useRef<Project | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  const persist = useCallback((next: Project, protectOnFailure: boolean): boolean => {
    cancelSave();
    const serialized = JSON.stringify(next);
    // An untouched empty workspace has no storage record. Undoing back to
    // empty, however, must remove the earlier record so reload stays empty.
    if ((!hasProjectContent(next) && savedSnapshot.current === null) || serialized === savedSnapshot.current) {
      dirty.current = false;
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    try {
      const written = persistProject(localStorage, next);
      savedSnapshot.current = hasProjectContent(next) ? written : null;
      dirty.current = false;
      setSaveState("saved");
      return true;
    } catch (error) {
      // Restoring an already saved snapshot or a untouched blank workspace
      // should not prompt on unload just because a new storage write failed.
      dirty.current = protectOnFailure && serialized !== savedSnapshot.current;
      setSaveState("unavailable");
      setNotice(error instanceof Error ? error.message : "Brauzer yaddaşına yazmaq mümkün olmadı. Son dəyişikliklər yalnız açıq səhifədədir.");
      return false;
    }
  }, [cancelSave]);

  const scheduleSave = useCallback((next: Project) => {
    cancelSave();
    const serialized = JSON.stringify(next);
    dirty.current = serialized !== savedSnapshot.current && (hasProjectContent(next) || savedSnapshot.current !== null);
    if (!dirty.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    saveTimer.current = setTimeout(() => persist(current.current, true), SAVE_DELAY);
  }, [cancelSave, persist]);

  const flush = useCallback(() => {
    cancelSave();
    return !dirty.current || persist(current.current, true);
  }, [cancelSave, persist]);

  const storedSnapshot = useCallback((id: string): { project: Project; serialized: string } | null => {
    const stored = localStorage.getItem(STORAGE_PREFIX + id);
    if (!stored) return null;
    // Earlier versions permitted larger drafts. Keep those readable while
    // applying the conservative storage limit only to future writes.
    const restored = parseProject(stored, MAX_FILE_SIZE);
    if (restored.id !== id) return null;
    return { project: restored, serialized: JSON.stringify(restored) };
  }, []);

  const cancelReplacement = useCallback(() => {
    pending.current = null;
    setUnsavedReplacement(false);
  }, []);

  const apply = useCallback((next: Project, restoredSnapshot: string | null = null) => {
    cancelSave();
    current.current = next;
    savedSnapshot.current = restoredSnapshot;
    history.current = [];
    historyGroup.current = null;
    future.current = [];
    setUndoCount(0);
    setRedoCount(0);
    cancelReplacement();
    setProject(next);
    setHash(next.id);
    persist(next, hasProjectContent(next));
  }, [cancelReplacement, cancelSave, persist]);

  useEffect(() => {
    function restore() {
      let restored: ReturnType<typeof storedSnapshot> = null;
      const id = window.location.hash.slice(1);
      if (/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        try {
          restored = storedSnapshot(id);
        } catch {
          setNotice("Saxlanmış layihə oxunmadı. Brauzerin yerli yaddaşının əlçatan olduğunu yoxla.");
        }
      }
      const next = restored?.project ?? createProject();
      // Blank workspaces need no stored record, but their hash stays stable
      // across reload. Clearing the hash still gives a fresh project ID.
      if (!restored && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) next.id = id;
      if (isReady.current && !flush()) {
        pending.current = next;
        setUnsavedReplacement(true);
        setHash(current.current.id);
        return;
      }
      // Clearing the hash intentionally starts a fresh workspace. Existing
      // project keys remain available at their original hash addresses.
      apply(next, restored?.serialized ?? null);
      isReady.current = true;
      setReady(true);
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      flush();
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    try { cleanupEmptyProjects(localStorage); } catch { /* Opening an empty workspace remains possible. */ }
    restore();
    window.addEventListener("hashchange", restore);
    // The ref is checked synchronously, including the same event turn in
    // which a write fails, before any React effect has a chance to run.
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("beforeunload", warnBeforeUnload);
      flush();
    };
  }, [apply, flush, storedSnapshot]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const update = useCallback((change: (previous: Project) => Project, historyKey?: string) => {
    if (!isReady.current) return;
    const previous = current.current;
    const next = change(previous);
    if (next === previous) return;
    const recorded = recordHistory(history.current, previous, historyGroup.current, historyKey, Date.now());
    history.current = recorded.snapshots;
    historyGroup.current = recorded.group;
    future.current = [];
    setUndoCount(history.current.length);
    setRedoCount(0);
    current.current = next;
    setProject(next);
    setHash(next.id);
    scheduleSave(next);
  }, [scheduleSave]);

  const undo = useCallback(() => {
    historyGroup.current = null;
    const previous = history.current.pop();
    if (!previous) return;
    future.current = [...future.current.slice(-(HISTORY_LIMIT - 1)), current.current];
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
    current.current = previous;
    setProject(previous);
    setHash(previous.id);
    scheduleSave(previous);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    historyGroup.current = null;
    const next = future.current.pop();
    if (!next) return;
    history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), current.current];
    setUndoCount(history.current.length);
    setRedoCount(future.current.length);
    current.current = next;
    setProject(next);
    setHash(next.id);
    scheduleSave(next);
  }, [scheduleSave]);

  const replace = useCallback((next: Project): boolean => {
    if (!isReady.current) return false;
    historyGroup.current = null;
    if (!flush()) {
      pending.current = next;
      setUnsavedReplacement(true);
      return false;
    }
    let snapshot: string | null = null;
    try { snapshot = storedSnapshot(next.id)?.serialized ?? null; } catch { /* The next write reports availability. */ }
    apply(next, snapshot);
    return true;
  }, [apply, flush, storedSnapshot]);

  const confirmReplacement = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    let snapshot: string | null = null;
    try { snapshot = storedSnapshot(next.id)?.serialized ?? null; } catch { /* Keep replacement usable in memory. */ }
    apply(next, snapshot);
  }, [apply, storedSnapshot]);

  const reset = useCallback((): boolean => {
    if (!isReady.current) return false;
    cancelSave();
    historyGroup.current = null;
    let removedCurrent = false;
    try {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX) || key === DIAGRAM_CLIPBOARD_KEY);
      for (const key of keys) {
        localStorage.removeItem(key);
        if (key === STORAGE_PREFIX + current.current.id) removedCurrent = true;
      }
    } catch {
      // A browser can fail after some removals. Re-save the current snapshot
      // if possible, and keep it protected in memory if writing also fails.
      if (removedCurrent) savedSnapshot.current = null;
      persist(current.current, true);
      setNotice("Brauzer yerli yaddaşın silinməsinə icazə vermədi. Hazırkı layihə açıq saxlanıldı.");
      return false;
    }
    apply(createProject());
    return true;
  }, [apply, cancelSave, persist]);

  return {
    project,
    ready,
    saveState,
    undoCount,
    redoCount,
    update,
    undo,
    redo,
    replace,
    reset,
    unsavedReplacement,
    confirmReplacement,
    cancelReplacement,
    notice,
    setNotice,
  };
}
