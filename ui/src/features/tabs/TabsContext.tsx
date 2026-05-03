import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSettings } from "../../settings";

export type TabKind = "collection" | "console" | "shell";

export interface Tab {
  id: string;
  kind: TabKind;
  /** Connection this tab is bound to. Doesn't change after creation. */
  connectionId: string;
  collection?: string;
}

interface TabsContextValue {
  tabs: Tab[];
  activeId: string | null;
  activeTab: Tab | null;
  openCollection: (connectionId: string, name: string) => void;
  openConsole: (connectionId: string) => void;
  openShell: (connectionId: string) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const STORAGE_KEY = "mango:tabs:v3";

const genId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

interface PersistedState {
  tabs: Tab[];
  activeId: string | null;
}

const loadState = (): PersistedState => {
  if (typeof window === "undefined") return { tabs: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.tabs)) return { tabs: [], activeId: null };
    return {
      tabs: parsed.tabs.filter(
        (t): t is Tab =>
          !!t &&
          typeof t.id === "string" &&
          typeof t.kind === "string" &&
          typeof t.connectionId === "string" &&
          t.connectionId.length > 0,
      ),
      activeId: parsed.activeId ?? null,
    };
  } catch {
    return { tabs: [], activeId: null };
  }
};

export const TabsProvider = ({ children }: { children: React.ReactNode }) => {
  const { tabMode } = useSettings();
  const [state, setState] = useState<PersistedState>(() => loadState());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const openCollection = useCallback(
    (connectionId: string, name: string) => {
      setState((prev) => {
        const existing = prev.tabs.find(
          (t) =>
            t.kind === "collection" &&
            t.collection === name &&
            t.connectionId === connectionId,
        );
        if (existing) return { ...prev, activeId: existing.id };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) =>
            t.id === prev.activeId
              ? {
                  id: t.id,
                  kind: "collection" as const,
                  connectionId,
                  collection: name,
                }
              : t,
          );
          return { tabs, activeId: prev.activeId };
        }
        const id = genId();
        return {
          tabs: [
            ...prev.tabs,
            { id, kind: "collection", connectionId, collection: name },
          ],
          activeId: id,
        };
      });
    },
    [tabMode],
  );

  const openConsole = useCallback(
    (connectionId: string) => {
      setState((prev) => {
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) =>
            t.id === prev.activeId
              ? { id: t.id, kind: "console" as const, connectionId }
              : t,
          );
          return { tabs, activeId: prev.activeId };
        }
        const id = genId();
        return {
          tabs: [...prev.tabs, { id, kind: "console", connectionId }],
          activeId: id,
        };
      });
    },
    [tabMode],
  );

  const openShell = useCallback(
    (connectionId: string) => {
      setState((prev) => {
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) =>
            t.id === prev.activeId
              ? { id: t.id, kind: "shell" as const, connectionId }
              : t,
          );
          return { tabs, activeId: prev.activeId };
        }
        const id = genId();
        return {
          tabs: [...prev.tabs, { id, kind: "shell", connectionId }],
          activeId: id,
        };
      });
    },
    [tabMode],
  );

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const tabs = prev.tabs.filter((t) => t.id !== id);
      let activeId = prev.activeId;
      if (activeId === id) {
        const fallback = tabs[idx] ?? tabs[idx - 1] ?? null;
        activeId = fallback?.id ?? null;
      }
      return { tabs, activeId };
    });
  }, []);

  const activate = useCallback((id: string) => {
    setState((prev) => (prev.activeId === id ? prev : { ...prev, activeId: id }));
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeId) ?? null,
    [state.tabs, state.activeId],
  );

  const value = useMemo(
    () => ({
      tabs: state.tabs,
      activeId: state.activeId,
      activeTab,
      openCollection,
      openConsole,
      openShell,
      closeTab,
      activate,
    }),
    [
      state.tabs,
      state.activeId,
      activeTab,
      openCollection,
      openConsole,
      openShell,
      closeTab,
      activate,
    ],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
};

export const useTabs = (): TabsContextValue => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within TabsProvider");
  return ctx;
};
