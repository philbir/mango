import { useEffect, useSyncExternalStore } from "react";
import { useWorkspaces } from "./useWorkspaces";

const STORAGE_KEY = "mango:active-workspace-id";

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStored = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// Module-level snapshot so every useActiveWorkspace() consumer stays in sync
// (one component picks, the others re-render). Same shape as useActiveConnection.
let snapshot: string | null = readStored();
const subscribers = new Set<() => void>();

const subscribe = (cb: () => void): (() => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};

const getSnapshot = (): string | null => snapshot;

const setStored = (id: string | null): void => {
  if (snapshot === id) return;
  snapshot = id;
  writeStored(id);
  for (const cb of subscribers) cb();
};

/**
 * Resolves the currently active workspace.
 *
 *   1. picker selection (localStorage)
 *   2. first workspace returned by the server (which is sorted by recency)
 *   3. null — caller renders the "no workspace" empty state
 */
export const useActiveWorkspace = () => {
  const { workspaces, enabled, isLoading, error, refetch } = useWorkspaces();
  const pickerId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    const ids = workspaces.map((w) => w.id);
    if (ids.length === 0) {
      if (pickerId !== null) setStored(null);
      return;
    }
    if (pickerId && ids.includes(pickerId)) return;
    setStored(workspaces[0]!.id);
  }, [workspaces, pickerId, enabled]);

  const active = workspaces.find((w) => w.id === pickerId) ?? null;
  return {
    active,
    activeId: pickerId,
    workspaces,
    enabled,
    isLoading,
    error,
    refetch,
    setActiveId: setStored,
  };
};
