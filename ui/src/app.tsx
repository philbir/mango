import { useEffect, useRef } from "react";
import { useAssistant } from "./features/assistant/AssistantContext";
import { AssistantPanel } from "./features/assistant/AssistantPanel";
import { AssistantToggle } from "./features/assistant/AssistantToggle";
import { Sidebar } from "./features/collections/Sidebar";
import { KeyHealthBanner } from "./features/connections/KeyHealthBanner";
import {
  ViewConnectionContext,
  useActiveConnection,
} from "./features/connections/useActiveConnection";
import { CollectionView } from "./features/documents/CollectionView";
import { ConsoleView } from "./features/documents/ConsoleView";
import { ShellView } from "./features/shell/ShellView";
import { TabBar } from "./features/tabs/TabBar";
import { useTabs } from "./features/tabs/TabsContext";
import { useSettings } from "./settings";

export const App = () => {
  const { tabMode } = useSettings();
  const { activeTab, closeTab } = useTabs();
  const { toggle } = useAssistant();
  const { pickerId, setActiveId } = useActiveConnection();

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
  // (so the sidebar shows matching databases/collections).
  useEffect(() => {
    if (!tabMode) return;
    if (!activeTab) return;
    if (activeTab.connectionId !== pickerId) {
      setActiveId(activeTab.connectionId);
    }
  }, [tabMode, activeTab, pickerId, setActiveId]);

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
      <KeyHealthBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {tabMode && <TabBar />}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!activeTab && <EmptyState />}
            {activeTab && (
              <ViewConnectionContext.Provider value={activeTab.connectionId}>
                {activeTab.kind === "collection" && activeTab.collection && (
                  <CollectionView
                    key={activeTab.id}
                    tabId={activeTab.id}
                    name={activeTab.collection}
                  />
                )}
                {activeTab.kind === "console" && (
                  <ConsoleView key={activeTab.id} tabId={activeTab.id} />
                )}
                {activeTab.kind === "shell" && (
                  <ShellView key={activeTab.id} tabId={activeTab.id} />
                )}
              </ViewConnectionContext.Provider>
            )}
          </div>
          <AssistantToggle />
        </main>
        <AssistantPanel />
      </div>
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
