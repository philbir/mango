import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSettings } from "../../settings";

export type TabKind =
  | "collection"
  | "console"
  | "shell"
  | "notebook"
  | "database";

export interface Tab {
  id: string;
  kind: TabKind;
  /** Connection this tab is bound to. Doesn't change after creation. */
  connectionId: string;
  collection?: string;
  /** Database name — set for `database` kind, and on `collection` tabs that
   * were opened from a non-default db (existing behavior uses activeDatabase). */
  database?: string;
  /**
   * When set, this tab is bound to a workspace file: edits flow through the
   * matching view (CollectionView for query/console, NotebookView for
   * notebooks) but Save writes back to the file at this path.
   */
  workspaceId?: string;
  workspaceFilePath?: string;
  /** Initial pageMode for collection tabs opened from a workspace file. */
  initialPageMode?: "query" | "console" | "info";
}

export interface OpenCollectionOptions {
  workspaceFile?: { workspaceId: string; filePath: string };
  initialPageMode?: "query" | "console" | "info";
}

export interface OpenConsoleOptions {
  workspaceFile?: { workspaceId: string; filePath: string };
}

interface TabsContextValue {
  tabs: Tab[];
  activeId: string | null;
  activeTab: Tab | null;
  openCollection: (
    connectionId: string,
    name: string,
    options?: OpenCollectionOptions,
  ) => void;
  openConsole: (connectionId: string, options?: OpenConsoleOptions) => void;
  openShell: (connectionId: string) => void;
  openDatabase: (connectionId: string, database: string) => void;
  openNotebook: (
    connectionId: string,
    workspaceId: string,
    filePath: string,
  ) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const STORAGE_KEY = "mango:tabs:v6";

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
    (
      connectionId: string,
      name: string,
      options?: OpenCollectionOptions,
    ) => {
      const wsId = options?.workspaceFile?.workspaceId;
      const wsPath = options?.workspaceFile?.filePath;
      setState((prev) => {
        const existing = prev.tabs.find(
          (t) =>
            t.kind === "collection" &&
            t.collection === name &&
            t.connectionId === connectionId &&
            t.workspaceId === wsId &&
            t.workspaceFilePath === wsPath,
        );
        if (existing) return { ...prev, activeId: existing.id };
        const tab: Tab = {
          id: prev.activeId && !tabMode ? prev.activeId : genId(),
          kind: "collection",
          connectionId,
          collection: name,
          ...(wsId && wsPath
            ? { workspaceId: wsId, workspaceFilePath: wsPath }
            : {}),
          ...(options?.initialPageMode
            ? { initialPageMode: options.initialPageMode }
            : {}),
        };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) => (t.id === prev.activeId ? tab : t));
          return { tabs, activeId: prev.activeId };
        }
        return { tabs: [...prev.tabs, tab], activeId: tab.id };
      });
    },
    [tabMode],
  );

  const openConsole = useCallback(
    (connectionId: string, options?: OpenConsoleOptions) => {
      const wsId = options?.workspaceFile?.workspaceId;
      const wsPath = options?.workspaceFile?.filePath;
      setState((prev) => {
        const existing =
          wsId && wsPath
            ? prev.tabs.find(
                (t) =>
                  t.kind === "console" &&
                  t.workspaceId === wsId &&
                  t.workspaceFilePath === wsPath,
              )
            : null;
        if (existing) return { ...prev, activeId: existing.id };
        const tab: Tab = {
          id: prev.activeId && !tabMode ? prev.activeId : genId(),
          kind: "console",
          connectionId,
          ...(wsId && wsPath
            ? { workspaceId: wsId, workspaceFilePath: wsPath }
            : {}),
        };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) => (t.id === prev.activeId ? tab : t));
          return { tabs, activeId: prev.activeId };
        }
        return { tabs: [...prev.tabs, tab], activeId: tab.id };
      });
    },
    [tabMode],
  );

  const openShell = useCallback(
    (connectionId: string) => {
      setState((prev) => {
        const tab: Tab = {
          id: prev.activeId && !tabMode ? prev.activeId : genId(),
          kind: "shell",
          connectionId,
        };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) => (t.id === prev.activeId ? tab : t));
          return { tabs, activeId: prev.activeId };
        }
        return { tabs: [...prev.tabs, tab], activeId: tab.id };
      });
    },
    [tabMode],
  );

  const openDatabase = useCallback(
    (connectionId: string, database: string) => {
      setState((prev) => {
        const existing = prev.tabs.find(
          (t) =>
            t.kind === "database" &&
            t.connectionId === connectionId &&
            t.database === database,
        );
        if (existing) return { ...prev, activeId: existing.id };
        const tab: Tab = {
          id: prev.activeId && !tabMode ? prev.activeId : genId(),
          kind: "database",
          connectionId,
          database,
        };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) => (t.id === prev.activeId ? tab : t));
          return { tabs, activeId: prev.activeId };
        }
        return { tabs: [...prev.tabs, tab], activeId: tab.id };
      });
    },
    [tabMode],
  );

  const openNotebook = useCallback(
    (connectionId: string, workspaceId: string, filePath: string) => {
      setState((prev) => {
        const existing = prev.tabs.find(
          (t) =>
            t.kind === "notebook" &&
            t.workspaceId === workspaceId &&
            t.workspaceFilePath === filePath,
        );
        if (existing) return { ...prev, activeId: existing.id };
        if (!tabMode && prev.activeId) {
          const tabs = prev.tabs.map((t) =>
            t.id === prev.activeId
              ? {
                  id: t.id,
                  kind: "notebook" as const,
                  connectionId,
                  workspaceId,
                  workspaceFilePath: filePath,
                }
              : t,
          );
          return { tabs, activeId: prev.activeId };
        }
        const id = genId();
        return {
          tabs: [
            ...prev.tabs,
            {
              id,
              kind: "notebook",
              connectionId,
              workspaceId,
              workspaceFilePath: filePath,
            },
          ],
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
      openDatabase,
      openNotebook,
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
      openDatabase,
      openNotebook,
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
