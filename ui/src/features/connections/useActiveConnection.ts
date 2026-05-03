import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { api } from "../../api/client";
import { useServerConfig } from "./useServerConfig";

const STORAGE_KEY = "mango:active-connection-id";

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

// Module-level picker state, shared across every useActiveConnection() call.
// Without this, each hook invocation gets its own useState — so a click in
// ConnectionPicker would never propagate to Sidebar, and the explorer would
// continue rendering the previous connection's databases/collections.
let pickerIdSnapshot: string | null = readStored();
const subscribers = new Set<() => void>();

const subscribePicker = (cb: () => void): (() => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};

const getPickerSnapshot = (): string | null => pickerIdSnapshot;

const setStoredPickerId = (id: string | null): void => {
  if (pickerIdSnapshot === id) return;
  pickerIdSnapshot = id;
  writeStored(id);
  for (const cb of subscribers) cb();
};

/**
 * Components rendered inside an active tab register the tab's connection ID
 * via this context. When set, `useActiveConnection().activeId` returns that
 * value instead of the picker selection — so views always operate against the
 * connection their tab was opened with, even if the user later flips the
 * picker to a different connection.
 *
 * Outside the provider (Sidebar, ConnectionPicker), the picker selection is
 * returned. `setActiveId` always controls the picker, regardless of context.
 */
export const ViewConnectionContext = createContext<string | null>(null);

/**
 * Resolves the currently active connection ID.
 *
 *   1. ViewConnectionContext (when rendered inside an active tab)
 *   2. shared picker selection (module-level, persisted to localStorage)
 *   3. Most recently used connection from the server
 *   4. First connection in the list (alphabetical)
 *   5. null — caller should prompt the user to add one
 */
export const useActiveConnection = () => {
  const config = useServerConfig();
  const isStandalone = config.mode === "standalone";
  const viewCid = useContext(ViewConnectionContext);
  const pickerId = useSyncExternalStore(
    subscribePicker,
    getPickerSnapshot,
    getPickerSnapshot,
  );

  const list = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.listConnections(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isStandalone) {
      const pinned = config.standaloneConnectionId ?? null;
      if (pinned !== pickerId) setStoredPickerId(pinned);
      return;
    }
    if (!list.data) return;
    const ids = list.data.connections.map((c) => c.id);
    if (ids.length === 0) {
      if (pickerId !== null) setStoredPickerId(null);
      return;
    }
    if (pickerId && ids.includes(pickerId)) return;
    setStoredPickerId(list.data.connections[0]!.id);
  }, [list.data, pickerId, isStandalone, config.standaloneConnectionId]);

  const setActiveId = (id: string | null) => {
    if (isStandalone) return;
    setStoredPickerId(id);
  };

  const effectiveId = viewCid ?? pickerId;
  const active =
    list.data?.connections.find((c) => c.id === effectiveId) ?? null;
  return {
    activeId: effectiveId,
    pickerId,
    active,
    setActiveId,
    connections: list.data?.connections ?? [],
    isLoading: list.isLoading,
    refetch: list.refetch,
  };
};
