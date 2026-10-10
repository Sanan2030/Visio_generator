"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createProject } from "./process";
import { MAX_STORED_SIZE, parseProject, STORAGE_PREFIX } from "./storage";
import type { Project } from "./types";

export type SaveState = "saving" | "saved" | "unavailable";

function hasContent(project: Project): boolean {
  return project.steps.length > 0
    || project.name !== "Yeni iş axını"
    || project.pools.length !== 1
    || project.pools[0].name !== "Təşkilat"
    || project.pools[0].lanes.length !== 1
    || project.pools[0].lanes[0].name !== "İştirakçı 1";
}

function setHash(id: string) {
  window.history.replaceState(window.history.state, "", `#${id}`);
}

/** Persist before an editing event returns so an immediate refresh is safe. */
export function useProject() {
  const [project, setProject] = useState<Project>(() => createProject());
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [undoCount, setUndoCount] = useState(0);
  const [unsavedReplacement, setUnsavedReplacement] = useState(false);
  const [notice, setNotice] = useState("");
  const current = useRef(project);
  const isReady = useRef(false);
  const history = useRef<Project[]>([]);
  const dirty = useRef(false);
  const savedSnapshot = useRef<string | null>(null);
  const pending = useRef<Project | null>(null);

  const persist = useCallback((next: Project, protectOnFailure: boolean): boolean => {
    setSaveState("saving");
    const serialized = JSON.stringify(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + next.id, serialized);
      savedSnapshot.current = serialized;
      dirty.current = false;
      setSaveState("saved");
      return true;
    } catch {
      // Restoring an already saved snapshot or a untouched blank workspace
      // should not prompt on unload just because a new storage write failed.
      dirty.current = protectOnFailure && serialized !== savedSnapshot.current;
      setSaveState("unavailable");
      return false;
    }
  }, []);

  const storedSnapshot = useCallback((id: string): { project: Project; serialized: string } | null => {
    const stored = localStorage.getItem(STORAGE_PREFIX + id);
    if (!stored) return null;
    const restored = parseProject(stored, MAX_STORED_SIZE);
    if (restored.id !== id) return null;
    return { project: restored, serialized: JSON.stringify(restored) };
  }, []);

  const cancelReplacement = useCallback(() => {
    pending.current = null;
    setUnsavedReplacement(false);
  }, []);

  const apply = useCallback((next: Project, restoredSnapshot: string | null = null) => {
    current.current = next;
    savedSnapshot.current = restoredSnapshot;
    history.current = [];
    setUndoCount(0);
    cancelReplacement();
    setProject(next);
    setHash(next.id);
    persist(next, hasContent(next));
  }, [cancelReplacement, persist]);

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
      // Clearing the hash intentionally starts a fresh workspace. Existing
      // project keys remain available at their original hash addresses.
      apply(restored?.project ?? createProject(), restored?.serialized ?? null);
      isReady.current = true;
      setReady(true);
    }
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    restore();
    window.addEventListener("hashchange", restore);
    // The ref is checked synchronously, including the same event turn in
    // which a write fails, before any React effect has a chance to run.
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [apply, storedSnapshot]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const update = useCallback((change: (previous: Project) => Project) => {
    if (!isReady.current) return;
    const previous = current.current;
    const next = change(previous);
    if (next === previous) return;
    history.current = [...history.current.slice(-29), previous];
    setUndoCount(history.current.length);
    current.current = next;
    setProject(next);
    setHash(next.id);
    persist(next, true);
  }, [persist]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    setUndoCount(history.current.length);
    current.current = previous;
    setProject(previous);
    setHash(previous.id);
    persist(previous, true);
  }, [persist]);

  const replace = useCallback((next: Project): boolean => {
    if (!isReady.current) return false;
    if (dirty.current && !persist(current.current, true)) {
      pending.current = next;
      setUnsavedReplacement(true);
      return false;
    }
    let snapshot: string | null = null;
    try { snapshot = storedSnapshot(next.id)?.serialized ?? null; } catch { /* The next write reports availability. */ }
    apply(next, snapshot);
    return true;
  }, [apply, persist, storedSnapshot]);

  const confirmReplacement = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    let snapshot: string | null = null;
    try { snapshot = storedSnapshot(next.id)?.serialized ?? null; } catch { /* Keep replacement usable in memory. */ }
    apply(next, snapshot);
  }, [apply, storedSnapshot]);

  const reset = useCallback((): boolean => {
    if (!isReady.current) return false;
    let removedCurrent = false;
    try {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
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
  }, [apply, persist]);

  return {
    project,
    ready,
    saveState,
    undoCount,
    update,
    undo,
    replace,
    reset,
    unsavedReplacement,
    confirmReplacement,
    cancelReplacement,
    notice,
    setNotice,
  };
}
