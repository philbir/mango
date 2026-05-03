import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
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
 *   2. localStorage picker selection
 *   3. Most recently used connection from the server
 *   4. First connection in the list (alphabetical)
 *   5. null — caller should prompt the user to add one
 */
export const useActiveConnection = () => {
  const config = useServerConfig();
  const isStandalone = config.mode === "standalone";
  const viewCid = useContext(ViewConnectionContext);
  const [pickerId, setPickerIdState] = useState<string | null>(() => readStored());

  const list = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.listConnections(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isStandalone) {
      const pinned = config.standaloneConnectionId ?? null;
      if (pinned !== pickerId) setPickerIdState(pinned);
      return;
    }
    if (!list.data) return;
    const ids = list.data.connections.map((c) => c.id);
    if (ids.length === 0) {
      if (pickerId !== null) {
        setPickerIdState(null);
        writeStored(null);
      }
      return;
    }
    if (pickerId && ids.includes(pickerId)) return;
    const fallback = list.data.connections[0]!.id;
    setPickerIdState(fallback);
    writeStored(fallback);
  }, [list.data, pickerId, isStandalone, config.standaloneConnectionId]);

  const setActiveId = (id: string | null) => {
    if (isStandalone) return;
    setPickerIdState(id);
    writeStored(id);
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
