import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
 * Resolves the currently active connection ID.
 *
 * Order of resolution:
 *   1. localStorage (last selected by the user)
 *   2. Most recently used connection from the server
 *   3. First connection in the list (alphabetical)
 *   4. null — caller should prompt the user to add one
 */
export const useActiveConnection = () => {
  const config = useServerConfig();
  const isStandalone = config.mode === "standalone";
  const [activeId, setActiveIdState] = useState<string | null>(() => readStored());

  const list = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.listConnections(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isStandalone) {
      // Server is the source of truth; ignore localStorage entirely.
      const pinned = config.standaloneConnectionId ?? null;
      if (pinned !== activeId) setActiveIdState(pinned);
      return;
    }
    if (!list.data) return;
    const ids = list.data.connections.map((c) => c.id);
    if (ids.length === 0) {
      if (activeId !== null) {
        setActiveIdState(null);
        writeStored(null);
      }
      return;
    }
    if (activeId && ids.includes(activeId)) return;
    // Either nothing selected, or stored id no longer exists — pick a default.
    const fallback = list.data.connections[0]!.id;
    setActiveIdState(fallback);
    writeStored(fallback);
  }, [list.data, activeId, isStandalone, config.standaloneConnectionId]);

  const setActiveId = (id: string | null) => {
    if (isStandalone) return;
    setActiveIdState(id);
    writeStored(id);
  };

  const active = list.data?.connections.find((c) => c.id === activeId) ?? null;
  return {
    activeId,
    active,
    setActiveId,
    connections: list.data?.connections ?? [],
    isLoading: list.isLoading,
    refetch: list.refetch,
  };
};
