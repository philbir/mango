import { useEffect, useRef } from "react";
import { useAssistant } from "./features/assistant/AssistantContext";
import { AssistantPanel } from "./features/assistant/AssistantPanel";
import { AssistantToggle } from "./features/assistant/AssistantToggle";
import { SidebarShell } from "./features/sidebar/SidebarShell";
import { KeyHealthBanner } from "./features/connections/KeyHealthBanner";
import {
  cancelOidcAuthPrompt,
  confirmOidcAuthPrompt,
  requiresOidcAuthPrompt,
  usePendingOidcAuthPrompt,
} from "./features/connections/oidcAuthPrompt";
import { OidcAuthDialog } from "./features/connections/OidcAuthDialog";
import { NotebookView } from "./features/workspaces/NotebookView";
import {
  ViewConnectionContext,
  useActiveConnection,
} from "./features/connections/useActiveConnection";
import { CollectionView } from "./features/documents/CollectionView";
import { ConsoleView } from "./features/documents/ConsoleView";
import { DatabaseView } from "./features/database/DatabaseView";
import { GridFsView } from "./features/gridfs/GridFsView";
import { ShellView } from "./features/shell/ShellView";
import { TabBar } from "./features/tabs/TabBar";
import { useTabs } from "./features/tabs/TabsContext";
import { UpdateBanner } from "./features/updater/UpdateBanner";
import { useSettings } from "./settings";
import { api } from "./api/client";

export const App = () => {
  const { tabMode } = useSettings();
  const { tabs, activeTab, closeTab } = useTabs();
  const { toggle } = useAssistant();
  const pendingOidcPrompt = usePendingOidcAuthPrompt();
  const { pickerId, setActiveId, connections, isLoading: connectionsLoading } =
    useActiveConnection();
  const activeTabConnection =
    activeTab
      ? connections.find((connection) => connection.id === activeTab.connectionId) ?? null
      : null;
  const blockedActiveTab = requiresOidcAuthPrompt(activeTabConnection);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Multi-tab: switching tab follows that tab's connection in the picker
  // (so the sidebar shows matching databases/collections). We trigger ONLY on
  // active-tab changes — without the ref guard, a manual picker change would
  // also fire this effect and immediately revert pickerId back to the active
  // tab's connection, defeating the picker.
  const lastActiveTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tabMode) {
      lastActiveTabIdRef.current = activeTab?.id ?? null;
      return;
    }
    const currentTabId = activeTab?.id ?? null;
    if (lastActiveTabIdRef.current === currentTabId) return;
    lastActiveTabIdRef.current = currentTabId;
    if (activeTab && activeTab.connectionId !== pickerId) {
      setActiveId(activeTab.connectionId);
    }
  }, [tabMode, activeTab, pickerId, setActiveId]);

  // Drop tabs that point at a connection no longer in the list (deleted, or
  // hidden by a mode switch). Without this, stale tabs keep firing requests
  // that 404 on the server.
  useEffect(() => {
    if (connectionsLoading) return;
    const known = new Set(connections.map((c) => c.id));
    for (const t of tabs) {
      if (!known.has(t.connectionId)) closeTab(t.id);
    }
  }, [connections, connectionsLoading, tabs, closeTab]);

  // Single-tab: when the picker connection changes, drop any open tab —
  // the page belongs to the previous connection and would query the wrong DB.
  const lastPickerRef = useRef<string | null>(pickerId);
  useEffect(() => {
    if (tabMode) {
      lastPickerRef.current = pickerId;
      return;
    }
    if (lastPickerRef.current !== pickerId) {
      lastPickerRef.current = pickerId;
      if (activeTab) closeTab(activeTab.id);
    }
  }, [tabMode, pickerId, activeTab, closeTab]);

  return (
    <div className="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <UpdateBanner />
      <KeyHealthBanner />
      <div className="flex min-h-0 flex-1">
        <SidebarShell />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {tabMode && <TabBar />}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!activeTab && <EmptyState />}
            {activeTab && !blockedActiveTab && (
              <ViewConnectionContext.Provider value={activeTab.connectionId}>
                {/*
                  Include the bound workspace file path in the React `key`
                  so single-tab navigation (which mutates the tab in place
                  rather than creating a new one) force-remounts the view
                  when switching between workspace files. Otherwise the
                  view's local state — pageMode, filter draft, selected
                  fields — sticks to the previous file's values.
                */}
                {activeTab.kind === "collection" && activeTab.collection && (
                  <CollectionView
                    key={`${activeTab.id}:${activeTab.workspaceFilePath ?? ""}`}
                    tabId={activeTab.id}
                    name={activeTab.collection}
                  />
                )}
                {activeTab.kind === "console" && (
                  <ConsoleView
                    key={`${activeTab.id}:${activeTab.workspaceFilePath ?? ""}`}
                    tabId={activeTab.id}
                  />
                )}
                {activeTab.kind === "shell" && (
                  <ShellView key={activeTab.id} tabId={activeTab.id} />
                )}
                {activeTab.kind === "notebook" && (
                  <NotebookView
                    key={`${activeTab.id}:${activeTab.workspaceFilePath ?? ""}`}
                    tabId={activeTab.id}
                  />
                )}
                {activeTab.kind === "database" && activeTab.database && (
                  <DatabaseView
                    key={`${activeTab.id}:${activeTab.database}`}
                    cid={activeTab.connectionId}
                    database={activeTab.database}
                  />
                )}
                {activeTab.kind === "gridfs" && activeTab.bucket && (
                  <GridFsView
                    key={`${activeTab.id}:${activeTab.bucket}:${activeTab.database ?? ""}`}
                    tabId={activeTab.id}
                  />
                )}
              </ViewConnectionContext.Provider>
            )}
            {activeTab && blockedActiveTab && <EmptyState />}
          </div>
          <AssistantToggle />
        </main>
        <AssistantPanel />
      </div>
      {pendingOidcPrompt && (
        <OidcAuthDialog
          connectionName={pendingOidcPrompt.connection.name}
          initialBrowser={pendingOidcPrompt.connection.oidcBrowser}
          initialBrowserProfile={pendingOidcPrompt.connection.oidcBrowserProfile}
          forceRestart={pendingOidcPrompt.mode === "retry"}
          confirmLabel={
            pendingOidcPrompt.mode === "retry" ? "Retry authentication" : "Continue"
          }
          message={
            pendingOidcPrompt.mode === "retry" ? (
              <>
                The previous browser sign-in appears stuck or expired. Pick a
                browser and restart authentication for this connection.
              </>
            ) : (
              <>
                This connection needs to authenticate using a browser before
                Mango can connect.
              </>
            )
          }
          onConfirm={confirmOidcAuthPrompt}
          onReopen={async ({ oidcBrowser, oidcBrowserProfile }) => {
            await api.reopenOidcBrowserAuth(pendingOidcPrompt.connection.id, {
              oidcBrowser,
              oidcBrowserProfile,
            });
          }}
          onCancel={cancelOidcAuthPrompt}
        />
      )}
    </div>
  );
};

const EmptyState = () => (
  <div className="flex h-full items-center justify-center overflow-hidden bg-white px-8 py-10 text-center text-slate-500 dark:bg-slate-950 dark:text-slate-400">
    <div className="flex w-full max-w-3xl flex-col items-center">
      <img
        src="/assets/mango-empty-hero.png"
        alt=""
        className="mb-4 w-full max-w-[520px] select-none object-contain dark:hidden"
        draggable={false}
      />
      <img
        src="/assets/mango-empty-hero-dark.png"
        alt=""
        className="mb-4 hidden w-full max-w-[520px] select-none object-contain dark:block"
        draggable={false}
      />
      <div className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
        <img
          src="/assets/mango-mark.svg"
          alt=""
          className="h-6 w-6 dark:hidden"
          draggable={false}
        />
        <img
          src="/assets/mango-mark-dark.svg"
          alt=""
          className="hidden h-6 w-6 dark:block"
          draggable={false}
        />
        Mango
      </div>
      <div className="mt-2 max-w-md text-sm leading-6">
        Pick a database collection from the sidebar to inspect documents, shape
        queries, and explore data with AI.
      </div>
    </div>
  </div>
);
