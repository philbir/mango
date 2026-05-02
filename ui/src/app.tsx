import { Sidebar } from "./features/collections/Sidebar";
import { CollectionView } from "./features/documents/CollectionView";
import { ConsoleView } from "./features/documents/ConsoleView";
import { ShellView } from "./features/shell/ShellView";
import { TabBar } from "./features/tabs/TabBar";
import { useTabs } from "./features/tabs/TabsContext";
import { useSettings } from "./settings";

export const App = () => {
  const { tabMode } = useSettings();
  const { activeTab } = useTabs();

  return (
    <div className="flex h-full bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        {tabMode && <TabBar />}
        <div className="flex flex-1 flex-col overflow-hidden">
          {!activeTab && <EmptyState />}
          {activeTab?.kind === "collection" && activeTab.collection && (
            <CollectionView
              key={activeTab.id}
              name={activeTab.collection}
            />
          )}
          {activeTab?.kind === "console" && (
            <ConsoleView key={activeTab.id} />
          )}
          {activeTab?.kind === "shell" && <ShellView key={activeTab.id} />}
        </div>
      </main>
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
